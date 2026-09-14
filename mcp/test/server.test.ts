import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { decryptWithFragmentKey } from '../../resources/js/lib/crypto-core.ts';
import { PastebucketClient } from '../src/client.ts';
import { loadConfig } from '../src/config.ts';
import { createPastebucketServer } from '../src/server.ts';
import { FakeApi } from './fake-api.ts';

let fake: FakeApi;
let stateDir: string;

async function connect(getClient: () => PastebucketClient) {
    const server = createPastebucketServer(getClient);
    const mcp = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
    return mcp;
}

const aliceClient = () => new PastebucketClient({ baseUrl: fake.url, token: 'token-alice', stateDir }, { sleep: async () => {} });

beforeEach(async () => {
    fake = await new FakeApi().start();
    stateDir = await mkdtemp(join(tmpdir(), 'pastebucket-mcp-server-'));
});

afterEach(async () => {
    await fake.close();
    await rm(stateDir, { recursive: true, force: true });
});

describe('MCP server', () => {
    test('advertises the three tools and verbatim-publishing instructions', async () => {
        const mcp = await connect(aliceClient);

        const { tools } = await mcp.listTools();
        expect(tools.map(t => t.name).sort()).toEqual(['get_output_status', 'publish_output', 'revoke_output']);

        const publish = tools.find(t => t.name === 'publish_output')!;
        expect(publish.inputSchema.required).toEqual(['markdown']);
        expect(Object.keys(publish.inputSchema.properties ?? {}).sort()).toEqual(['expires_in_days', 'markdown', 'password', 'title']);
        expect(tools.find(t => t.name === 'revoke_output')!.annotations?.destructiveHint).toBe(true);
        expect(tools.find(t => t.name === 'get_output_status')!.annotations?.readOnlyHint).toBe(true);

        const instructions = mcp.getInstructions() ?? '';
        expect(instructions).toContain('verbatim');
        expect(instructions).toContain('Do not send the link');
        expect(instructions).toContain('not available to you verbatim');
    });

    test('publish_output returns the link and exact expiry; status and revoke work', async () => {
        const mcp = await connect(aliceClient);
        const markdown = '# Offerte\n\n| Post | Bedrag |\n|---|---:|\n| Hosting | € 12,50 |\n\n```bash\necho  "hi"\n```\n';

        const published: any = await mcp.callTool({
            name: 'publish_output',
            arguments: { title: 'Offerte', markdown },
        });

        expect(published.isError).toBeFalsy();
        const data = published.structuredContent;
        expect(data.share_url).toMatch(new RegExp(`^${fake.url}/p/${data.slug}#k=[A-Za-z0-9_-]{43}$`));
        expect(Date.parse(data.expires_at) - Date.parse(data.created_at)).toBe(7 * 24 * 3_600_000);
        expect(published.content[0].text).toContain(`Expires at: ${data.expires_at} (UTC)`);
        expect(published.content[0].text).toContain('has not been sent to anyone');

        const stored = fake.pastes.get(data.slug)!;
        const key = data.share_url.split('#k=')[1];
        expect(await decryptWithFragmentKey(stored.content!, stored.encryption_meta as any, key)).toBe(markdown);

        const status: any = await mcp.callTool({ name: 'get_output_status', arguments: { slug: data.slug } });
        expect(status.structuredContent).toMatchObject({ status: 'active', expires_at: data.expires_at, password_protected: false });

        const revoked: any = await mcp.callTool({ name: 'revoke_output', arguments: { slug: data.slug } });
        expect(revoked.structuredContent.status).toBe('revoked');
        expect(revoked.content[0].text).toContain('no longer works');
    });

    test('password publish reminds to share the password separately', async () => {
        const mcp = await connect(aliceClient);
        const result: any = await mcp.callTool({
            name: 'publish_output',
            arguments: { title: 'x', markdown: 'geheim', password: 'lang-genoeg-wachtwoord', expires_in_days: 2 },
        });

        expect(result.structuredContent.password_protected).toBe(true);
        expect(result.structuredContent.share_url).not.toContain('#');
        expect(result.content[0].text).toContain('share the password');
        expect(JSON.stringify(result)).not.toContain('lang-genoeg-wachtwoord');
    });

    test('errors come back as readable tool errors, including missing configuration', async () => {
        const unconfigured = await connect(() => new PastebucketClient(loadConfig({})));
        const missing: any = await unconfigured.callTool({ name: 'publish_output', arguments: { markdown: 'x' } });
        expect(missing.isError).toBe(true);
        expect(missing.content[0].text).toContain('PASTEBUCKET_URL');

        const mcp = await connect(aliceClient);
        const notFound: any = await mcp.callTool({ name: 'get_output_status', arguments: { slug: 'DoesNotExist1234' } });
        expect(notFound.isError).toBe(true);
        expect(notFound.content[0].text).toContain('Paste not found');

        const tooLong: any = await mcp.callTool({ name: 'publish_output', arguments: { markdown: 'x', expires_in_days: 9999 } });
        expect(tooLong.isError).toBe(true);
        expect(tooLong.content[0].text).toContain('between 1 and 365');
        expect(fake.postRequests()).toHaveLength(0);
    });
});
