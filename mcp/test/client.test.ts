import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { decryptWithFragmentKey, decryptWithPassword } from '../../resources/js/lib/crypto-core.ts';
import { PastebucketClient, slugFrom, type ClientOptions } from '../src/client.ts';
import { loadConfig, normalizeBaseUrl } from '../src/config.ts';
import { PastebucketError } from '../src/errors.ts';
import { RECOVERY_LIFETIME_MS } from '../src/recovery.ts';
import { FakeApi } from './fake-api.ts';

const MARKER = 'PLAINTEXT-MARKER-5f1c9a';

let fake: FakeApi;
let stateDir: string;
let clock: number;

function client(token = 'token-alice', options: ClientOptions = {}): PastebucketClient {
    return new PastebucketClient(
        { baseUrl: fake.url, token, stateDir },
        { sleep: async () => {}, now: () => clock, ...options },
    );
}

function keyFrom(shareUrl: string): string {
    const key = new URL(shareUrl).hash.match(/^#k=([A-Za-z0-9_-]+)$/)?.[1];
    if (!key) throw new Error('share URL has no key');
    return key;
}

async function decryptStored(slug: string, key: string): Promise<string> {
    const paste = fake.pastes.get(slug)!;
    return decryptWithFragmentKey(paste.content!, paste.encryption_meta as any, key);
}

async function pendingFiles(): Promise<string[]> {
    return readdir(join(stateDir, 'pending')).catch(() => []);
}

async function expectError(promise: Promise<unknown>, code: string): Promise<PastebucketError> {
    const error = await promise.then(() => null, e => e);
    expect(error).toBeInstanceOf(PastebucketError);
    expect(error.code).toBe(code);
    return error;
}

/** ~2 MB of the kind of text that breaks naive pipelines. */
function transcript(): string {
    const block = [
        '## User\r\n',
        `Kun je de offerte controleren? ${MARKER}\r\n`,
        '\r\n## Assistant\r\n',
        '\tIngesprongen met tab,  dubbele spaties   en trailing spaces   \n',
        'Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich. 日本語 🤖🎉 👩‍💻\n',
        '| Kolom | Waarde |\n|---|---:|\n| a \\| b | 1 |\n',
        '```php\n<?php echo "x";\n\n\n```\n',
        '[link](https://example.com/path?q=1&r=2)\n\n',
    ].join('');
    return '﻿' + block.repeat(Math.ceil((2 * 1024 * 1024) / block.length));
}

beforeEach(async () => {
    fake = await new FakeApi().start();
    stateDir = await mkdtemp(join(tmpdir(), 'pastebucket-mcp-test-'));
    clock = Date.now();
});

afterEach(async () => {
    await fake.close();
    await rm(stateDir, { recursive: true, force: true });
});

describe('publish', () => {
    test('defaults to an unlisted markdown document valid for seven days', async () => {
        const result = await client().publish({ content: `# Offerte\n\n${MARKER}` });

        const body = JSON.parse(fake.postRequests()[0].body);
        expect(body).toMatchObject({
            title: 'Shared document',
            content_format: 'markdown',
            visibility: 'unlisted',
            expires_in_hours: 168,
            burn_after_read: false,
            encryption_version: 1,
        });
        expect(Object.keys(body.encryption_meta).sort()).toEqual(['iv', 'mode']);

        expect(Date.parse(result.expires_at) - Date.parse(result.created_at)).toBe(7 * 24 * 3_600_000);
        expect(result.share_url).toBe(`${fake.url}/p/${result.slug}#k=${keyFrom(result.share_url)}`);
        expect(result.content_format).toBe('markdown');
        expect(result.password_protected).toBe(false);
    });

    test('never sends plaintext, the fragment key or the password', async () => {
        const fragment = await client().publish({ content: MARKER });
        const locked = await client().publish({ content: `${MARKER} two`, password: 'hunter2-hunter2' });

        const key = keyFrom(fragment.share_url);
        expect(locked.share_url).not.toContain('#');

        for (const request of fake.requests) {
            const wire = request.body + JSON.stringify({ ...request.headers, authorization: undefined }) + request.path;
            expect(wire).not.toContain(MARKER);
            expect(wire).not.toContain(key);
            expect(wire).not.toContain('hunter2-hunter2');
        }
    });

    test('a 2 MB transcript decrypts back to exactly the same string', async () => {
        const text = transcript();
        const result = await client().publish({ content: text, title: 'Gesprek' });

        expect(result.content_bytes).toBe(Buffer.byteLength(text));
        const decrypted = await decryptStored(result.slug, keyFrom(result.share_url));
        expect(decrypted.length).toBe(text.length);
        expect(decrypted === text).toBe(true);
    });

    test('password mode round-trips and has no key in the link', async () => {
        const result = await client().publish({ content: 'Vertrouwelijk 🤐', password: 'correct horse battery' });
        const paste = fake.pastes.get(result.slug)!;

        expect(result.password_protected).toBe(true);
        expect(result.share_url).toBe(`${fake.url}/p/${result.slug}`);
        await expect(
            decryptWithPassword(paste.content!, paste.encryption_meta as any, 'correct horse battery'),
        ).resolves.toBe('Vertrouwelijk 🤐');
    });

    test('oversized content is refused with byte counts before anything is sent', async () => {
        await fake.close();
        fake = await new FakeApi({ maxContentBytes: 1000 }).start();

        // 501 two-byte characters: 1002 bytes, though only 501 JS characters.
        const error = await expectError(client().publish({ content: 'é'.repeat(501) }), 'too_large');
        expect(error.message).toContain('1002 bytes');
        expect(error.message).toContain('1000 bytes');
        expect(fake.postRequests()).toHaveLength(0);
        expect(await pendingFiles()).toHaveLength(0);
    });

    test('a 413 from the server is surfaced with its byte counts', async () => {
        const reply413 = new Response(JSON.stringify({
            message: 'Content is 9 bytes; the maximum is 8 bytes.', error: 'payload_too_large', content_bytes: 9, max_content_bytes: 8,
        }), { status: 413 });
        const error = await expectError(client('token-alice', {
            fetch: (async (url: string, init: RequestInit) => init.method === 'POST' ? reply413 : fetch(url, init)) as typeof fetch,
        }).publish({ content: 'x' }), 'too_large');
        expect(error.message).toContain('Content is 9 bytes; the maximum is 8 bytes.');
    });

    test('rejects empty content, long titles and out-of-range expiry without a request', async () => {
        await expectError(client().publish({ content: '' }), 'invalid_input');
        await expectError(client().publish({ content: '  \n\t' }), 'invalid_input');
        await expectError(client().publish({ content: 'x', title: 'a'.repeat(256) }), 'invalid_input');
        await expectError(client().publish({ content: 'x', expiresInDays: 0 }), 'invalid_input');
        await expectError(client().publish({ content: 'x', expiresInDays: 366 }), 'invalid_input');
        await expectError(client().publish({ content: 'x', expiresInDays: 1.5 }), 'invalid_input');
        await expectError(client().publish({ content: 'x', expiresInHours: 8761 }), 'invalid_input');
        await expectError(client().publish({ content: 'x', expiresInDays: 1, expiresInHours: 2 }), 'invalid_input');
        await expectError(client().publish({ content: 'x', password: 'short' }), 'invalid_input');

        // A 255-character emoji title is 255 characters, not 510 UTF-16 units.
        await expect(client().publish({ content: 'x', title: '🙂'.repeat(255) })).resolves.toBeTruthy();
        expect(fake.postRequests()).toHaveLength(1);
    });

    test('custom expiry within the account limit is sent as hours', async () => {
        const result = await client().publish({ content: 'x', expiresInDays: 30 });
        expect(JSON.parse(fake.postRequests()[0].body).expires_in_hours).toBe(720);
        expect(Date.parse(result.expires_at) - Date.parse(result.created_at)).toBe(30 * 24 * 3_600_000);
    });
});

describe('retries and recovery', () => {
    test('a 503 is retried with the identical idempotency key and ciphertext', async () => {
        fake.failPosts = [503];
        const result = await client().publish({ content: MARKER });

        const posts = fake.postRequests();
        expect(posts).toHaveLength(2);
        expect(posts[0].headers['idempotency-key']).toBeTruthy();
        expect(posts[1].headers['idempotency-key']).toBe(posts[0].headers['idempotency-key']);
        expect(posts[1].body).toBe(posts[0].body);
        expect(fake.pastes.size).toBe(1);
        expect(await decryptStored(result.slug, keyFrom(result.share_url))).toBe(MARKER);
    });

    test('429 is retried honouring Retry-After', async () => {
        const waits: number[] = [];
        fake.failPosts = [429];
        await client('token-alice', { sleep: async ms => { waits.push(ms); } }).publish({ content: 'x' });
        expect(waits).toEqual([0]);
        expect(fake.pastes.size).toBe(1);
    });

    test('a lost response is retried within the same call and the server replay keeps the key valid', async () => {
        fake.dropPostResponses = 1;
        const result = await client().publish({ content: MARKER });

        expect(result.replayed).toBe(true);
        expect(fake.pastes.size).toBe(1);
        expect(fake.postRequests()).toHaveLength(2);
        expect(fake.postRequests()[1].body).toBe(fake.postRequests()[0].body);
        expect(await decryptStored(result.slug, keyFrom(result.share_url))).toBe(MARKER);
    });

    test('a lost response followed by a new publish call yields one paste and a working key', async () => {
        fake.dropPostResponses = 3;
        const text = `Antwoord ${MARKER}\n| a | b |`;

        const error = await expectError(client().publish({ content: text, title: 'T' }), 'network');
        expect(error.message).toContain('kept locally for 24 hours');
        expect(error.message).not.toContain(MARKER);
        expect(fake.pastes.size).toBe(1);

        const files = await pendingFiles();
        expect(files).toHaveLength(1);
        if (process.platform !== 'win32') {
            expect((await stat(join(stateDir, 'pending'))).mode & 0o777).toBe(0o700);
            expect((await stat(join(stateDir, 'pending', files[0]))).mode & 0o777).toBe(0o600);
            expect((await stat(join(stateDir, 'secret'))).mode & 0o777).toBe(0o600);
        }
        // The file name is a keyed fingerprint, not something derived from content alone.
        expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);

        const result = await client().publish({ content: text, title: 'T' });

        expect(result.replayed).toBe(true);
        expect(fake.pastes.size).toBe(1);
        expect([...fake.pastes.keys()]).toEqual([result.slug]);
        expect(await decryptStored(result.slug, keyFrom(result.share_url))).toBe(text);
        expect(await pendingFiles()).toHaveLength(0);
    });

    test('recovery data is deleted after success and purged after 24 hours', async () => {
        await client().publish({ content: 'first' });
        expect(await pendingFiles()).toHaveLength(0);

        fake.dropPostResponses = 3;
        await expectError(client().publish({ content: 'stuck' }), 'network');
        expect(await pendingFiles()).toHaveLength(1);

        clock += RECOVERY_LIFETIME_MS + 60_000;
        await client().publish({ content: 'unrelated' });
        expect(await pendingFiles()).toHaveLength(0);

        // A stale record is never reused: the same content now becomes a new paste.
        const again = await client().publish({ content: 'stuck' });
        expect(again.replayed).toBe(false);
        // first, stuck (stored before its response was lost), unrelated, stuck again.
        expect(fake.pastes.size).toBe(4);
    });

    test('definitive refusals are reported clearly and leave no recovery data', async () => {
        const conflict = new Response(JSON.stringify({
            message: 'This Idempotency-Key was already used with a different request.', error: 'idempotency_key_reused',
        }), { status: 409 });
        const withPost = (reply: Response) => (async (url: string, init: RequestInit) =>
            init.method === 'POST' ? reply : fetch(url, init)) as typeof fetch;

        const e409 = await expectError(client('token-alice', { fetch: withPost(conflict) }).publish({ content: MARKER }), 'conflict');
        expect(e409.message).toContain('Idempotency-Key');

        const invalid = new Response(JSON.stringify({
            message: 'The title field must not be greater than 255 characters.',
            errors: { title: ['The title field must not be greater than 255 characters.'] },
        }), { status: 422 });
        const e422 = await expectError(client('token-alice', { fetch: withPost(invalid) }).publish({ content: MARKER }), 'validation');
        expect(e422.message).toContain('title: The title field');

        expect(await pendingFiles()).toHaveLength(0);

        const e401 = await expectError(client('token-bogus').publish({ content: MARKER }), 'unauthenticated');
        expect(e401.message).not.toContain('token-bogus');

        const e403 = await expectError(client('token-readonly').publish({ content: MARKER }), 'forbidden');
        expect(e403.message).toContain('pastes:create');

        for (const error of [e409, e422, e401, e403]) {
            expect(error.message).not.toContain(MARKER);
            expect(error.message).not.toContain('token-');
        }
    });

    test('an unreachable server gives a network error, not a hang', async () => {
        await fake.close();
        const error = await expectError(client().publish({ content: 'x' }), 'network');
        expect(error.message).toContain('Could not reach PasteBucket');
        fake = await new FakeApi().start();
    });
});

describe('status and revoke', () => {
    test('reports status, revokes, and refuses other accounts', async () => {
        const published = await client().publish({ content: MARKER, expiresInDays: 3 });

        const status = await client().status(published.slug);
        expect(status).toMatchObject({ slug: published.slug, status: 'active', expires_at: published.expires_at });

        await expectError(client('token-bob').status(published.slug), 'not_found');
        await expectError(client('token-bob').revoke(published.slug), 'not_found');
        await expectError(client('token-readonly').revoke(published.slug), 'forbidden');

        // A share URL works as input, and its key never leaves the machine.
        const revoked = await client().revoke(published.share_url);
        expect(revoked.status).toBe('revoked');
        expect(revoked.revoked_at).toBeTruthy();
        expect(fake.requests.some(r => r.path.includes(keyFrom(published.share_url)))).toBe(false);

        expect((await client().revoke(published.slug)).status).toBe('revoked');
        expect((await client().status(published.slug)).status).toBe('revoked');
    });

    test('slugFrom accepts slugs and paste URLs and rejects anything else', () => {
        expect(slugFrom('AbCdEfGhIjKlMnOp')).toBe('AbCdEfGhIjKlMnOp');
        expect(slugFrom('https://paste.example/p/AbCdEfGhIjKlMnOp#k=secret')).toBe('AbCdEfGhIjKlMnOp');
        expect(() => slugFrom('../../admin')).toThrow(PastebucketError);
        expect(() => slugFrom('')).toThrow(PastebucketError);
    });
});

describe('config', () => {
    test('requires a URL and a token, and https outside loopback', () => {
        expect(() => loadConfig({})).toThrow(/PASTEBUCKET_URL/);
        expect(() => loadConfig({ PASTEBUCKET_URL: 'https://paste.example' })).toThrow(/API token/);
        expect(() => normalizeBaseUrl('http://paste.example')).toThrow(/https/);
        expect(normalizeBaseUrl('http://localhost:8040/')).toBe('http://localhost:8040');
        expect(normalizeBaseUrl('https://paste.example/sub/')).toBe('https://paste.example/sub');

        const config = loadConfig({
            PASTEBUCKET_URL: 'https://paste.example',
            PASTEBUCKET_API_TOKEN: ' abc ',
            XDG_STATE_HOME: '/tmp/xdg',
        });
        expect(config).toEqual({ baseUrl: 'https://paste.example', token: 'abc', stateDir: '/tmp/xdg/pastebucket' });
    });
});
