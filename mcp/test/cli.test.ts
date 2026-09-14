import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { decryptWithFragmentKey, decryptWithPassword } from '../../resources/js/lib/crypto-core.ts';
import { runCli } from '../src/cli.ts';
import { FakeApi } from './fake-api.ts';

let fake: FakeApi;
let dir: string;

async function cli(argv: string[], options: { stdin?: Uint8Array; env?: Record<string, string> } = {}) {
    let stdout = '';
    let stderr = '';
    const code = await runCli(argv, {
        stdout: { write: (s: string) => { stdout += s; } },
        stderr: { write: (s: string) => { stderr += s; } },
        stdin: Readable.from(options.stdin ? [Buffer.from(options.stdin)] : []),
        env: {
            PASTEBUCKET_URL: fake.url,
            PASTEBUCKET_API_TOKEN: 'token-alice',
            PASTEBUCKET_STATE_DIR: join(dir, 'state'),
            ...options.env,
        },
        cwd: dir,
        clientOptions: { sleep: async () => {} },
    });
    return { code, stdout, stderr };
}

async function storedPlaintext(shareUrl: string): Promise<string> {
    const url = new URL(shareUrl);
    const slug = url.pathname.split('/').pop()!;
    const paste = fake.pastes.get(slug)!;
    return decryptWithFragmentKey(paste.content!, paste.encryption_meta as any, url.hash.slice(3));
}

beforeEach(async () => {
    fake = await new FakeApi().start();
    dir = await mkdtemp(join(tmpdir(), 'pastebucket-cli-'));
});

afterEach(async () => {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
});

describe('pastebucket CLI', () => {
    test('publishes a Markdown file byte for byte as a document', async () => {
        const markdown = '\uFEFF# Transcript\r\n\r\n- [ ] taak\n- [x] klaar\n\n```\n\tcode\n```\n🤖\n';
        await writeFile(join(dir, 'answer.md'), markdown);

        const { code, stdout } = await cli(['publish', 'answer.md', '--title', 'Antwoord', '--json']);
        expect(code).toBe(0);

        const result = JSON.parse(stdout);
        expect(result.content_format).toBe('markdown');
        expect(result.content_bytes).toBe(Buffer.byteLength(markdown));
        expect(await storedPlaintext(result.share_url)).toBe(markdown);
        expect(JSON.parse(fake.postRequests()[0].body)).toMatchObject({ title: 'Antwoord', expires_in_hours: 168 });
    });

    test('publishes a text transcript as whitespace-preserving text, with human output', async () => {
        const bytes = await readFile(new URL('./fixtures/conversation.txt', import.meta.url));
        await writeFile(join(dir, 'conversation.txt'), bytes);

        const { code, stdout } = await cli(['publish', 'conversation.txt', '--expires-days', '3']);
        expect(code).toBe(0);
        expect(stdout).toMatch(/Published: {2}http:\/\/127\.0\.0\.1:\d+\/p\/\w{16}#k=/);
        expect(stdout).toMatch(/Expires: {4}\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z \(UTC\)/);
        expect(stdout).toContain('has not been sent to anyone');

        const body = JSON.parse(fake.postRequests()[0].body);
        expect(body).toMatchObject({ content_format: 'code', language: 'text', expires_in_hours: 72 });

        const shareUrl = stdout.match(/Published: {2}(\S+)/)![1];
        expect(Buffer.from(await storedPlaintext(shareUrl))).toEqual(bytes);
    });

    test('reads stdin for "-" and honours --format markdown', async () => {
        const { code, stdout } = await cli(['publish', '-', '--format', 'markdown', '--json'], {
            stdin: new TextEncoder().encode('## Via stdin\n\nÉén regel.'),
        });
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.content_format).toBe('markdown');
        expect(await storedPlaintext(result.share_url)).toBe('## Via stdin\n\nÉén regel.');
    });

    test('takes a password from the environment, never from argv', async () => {
        await writeFile(join(dir, 'secret.md'), 'vertrouwelijk');

        const rejected = await cli(['publish', 'secret.md', '--password', 'on-the-command-line']);
        expect(rejected.code).toBe(2);
        expect(fake.postRequests()).toHaveLength(0);

        const { code, stdout } = await cli(['publish', 'secret.md', '--password-env', 'PB_PW', '--json'], {
            env: { PB_PW: 'wachtwoord-uit-env' },
        });
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.password_protected).toBe(true);
        expect(result.share_url).not.toContain('#');
        expect(stdout).not.toContain('wachtwoord-uit-env');

        const paste = fake.pastes.get(result.slug)!;
        await expect(decryptWithPassword(paste.content!, paste.encryption_meta as any, 'wachtwoord-uit-env'))
            .resolves.toBe('vertrouwelijk');
    });

    test('refuses invalid UTF-8, missing files and bad flags without publishing', async () => {
        await writeFile(join(dir, 'broken.txt'), Buffer.from([0x68, 0x69, 0xff, 0xfe]));

        const broken = await cli(['publish', 'broken.txt']);
        expect(broken.code).toBe(1);
        expect(broken.stderr).toContain('not valid UTF-8');

        const missing = await cli(['publish', 'nope.md']);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toContain('File not found: nope.md');

        expect((await cli(['publish', 'x.md', '--format', 'html'])).code).toBe(2);
        expect((await cli(['publish'])).code).toBe(2);
        expect((await cli(['frobnicate'])).code).toBe(2);
        expect(fake.postRequests()).toHaveLength(0);
    });

    test('status and revoke', async () => {
        await writeFile(join(dir, 'a.md'), 'a');
        const { stdout } = await cli(['publish', 'a.md', '--json']);
        const { slug } = JSON.parse(stdout);

        const status = await cli(['status', slug]);
        expect(status.code).toBe(0);
        expect(status.stdout).toContain('Status:     active');

        const revoke = await cli(['revoke', slug, '--json']);
        expect(revoke.code).toBe(0);
        expect(JSON.parse(revoke.stdout).status).toBe('revoked');

        const unauthorised = await cli(['status', slug], { env: { PASTEBUCKET_API_TOKEN: 'token-bob' } });
        expect(unauthorised.code).toBe(1);
        expect(unauthorised.stderr).toContain('Paste not found');
    });

    test('missing configuration is explained', async () => {
        await writeFile(join(dir, 'a.md'), 'a');
        const { code, stderr } = await cli(['publish', 'a.md'], { env: { PASTEBUCKET_API_TOKEN: '' } });
        expect(code).toBe(1);
        expect(stderr).toContain('No API token configured');
    });
});
