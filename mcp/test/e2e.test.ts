import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decryptWithFragmentKey } from '../../resources/js/lib/crypto-core.ts';
import { PastebucketClient } from '../src/client.ts';
import { normalizeBaseUrl } from '../src/config.ts';

/**
 * End to end against a real PasteBucket (e.g. the local dev server):
 *
 *   PASTEBUCKET_E2E_URL=http://localhost:8040 PASTEBUCKET_E2E_TOKEN=... npx vitest run mcp/test/e2e.test.ts
 *
 * It proves the part no fake can: the ciphertext the Laravel app stores and
 * serves to a browser is exactly what the fragment key in our link opens.
 */
const baseUrl = process.env.PASTEBUCKET_E2E_URL;
const token = process.env.PASTEBUCKET_E2E_TOKEN;

function inertiaPage(html: string): any {
    const script = html.match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/);
    if (script) return JSON.parse(script[1]);

    const attribute = html.match(/data-page="([^"]*)"/);
    if (!attribute) throw new Error('No Inertia page data found in the HTML.');
    const decoded = attribute[1]
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    return JSON.parse(decoded);
}

describe.skipIf(!baseUrl || !token)('e2e against a running PasteBucket', () => {
    test('publish, open in the web view, decrypt exactly, revoke', async () => {
        const stateDir = await mkdtemp(join(tmpdir(), 'pastebucket-e2e-'));
        try {
            const client = new PastebucketClient({ baseUrl: normalizeBaseUrl(baseUrl!), token: token!, stateDir });
            const text = await readFile(new URL('./fixtures/conversation.txt', import.meta.url), 'utf8');
            const markdown = `# E2E ${new Date().toISOString()}\n\n${text}`;

            const result = await client.publish({ content: markdown, title: 'E2E test document' });
            expect(result.share_url).toContain(`/p/${result.slug}#k=`);
            expect(Date.parse(result.expires_at) - Date.parse(result.created_at)).toBe(7 * 24 * 3_600_000);

            const pageUrl = result.share_url.split('#')[0];
            const response = await fetch(pageUrl);
            expect(response.status).toBe(200);
            const page = inertiaPage(await response.text());
            expect(page.props.paste.content_format).toBe('markdown');

            const key = result.share_url.split('#k=')[1];
            const decrypted = await decryptWithFragmentKey(page.props.paste.content, page.props.paste.encryption_meta, key);
            expect(decrypted === markdown).toBe(true);

            expect((await client.status(result.slug)).status).toBe('active');
            expect((await client.revoke(result.slug)).status).toBe('revoked');
            expect((await client.status(result.slug)).status).toBe('revoked');

            const after = await fetch(pageUrl);
            expect(after.status).toBeGreaterThanOrEqual(400);
            expect(await after.text()).not.toContain(page.props.paste.content);
        } finally {
            await rm(stateDir, { recursive: true, force: true });
        }
    });
});
