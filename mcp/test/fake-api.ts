import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-process stand-in for the PasteBucket v1 API, written from the contract
 * the Laravel side implements. It records every request verbatim so tests can
 * assert on exactly what left the client -- which is the whole point of
 * client-side encryption.
 */

export interface RecordedRequest {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

export interface StoredPaste {
    slug: string;
    owner: string;
    title: string | null;
    content: string | null;
    content_format: string;
    language: string | null;
    visibility: string;
    burn_after_read: boolean;
    encryption_meta: Record<string, unknown>;
    created_at: string;
    expires_at: string;
    revoked_at: string | null;
}

export interface FakeApiOptions {
    maxContentBytes?: number;
    maxExpiryHours?: number;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN = ['password', 'key', 'fragment_key', 'plaintext'];

function isoMicro(date: Date): string {
    return date.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

export class FakeApi {
    url = '';
    readonly requests: RecordedRequest[] = [];
    readonly pastes = new Map<string, StoredPaste>();
    /** token -> owner + abilities */
    readonly tokens = new Map<string, { owner: string; abilities: string[] }>();
    readonly limits: { max_content_bytes: number; max_expiry_hours: number };

    /** Statuses to answer the next POST /pastes attempts with, without storing. */
    failPosts: number[] = [];
    /** Store the next N POST /pastes, then kill the socket before replying. */
    dropPostResponses = 0;

    private readonly idempotency = new Map<string, { hash: string; slug: string }>();
    private readonly server = createServer((req, res) => void this.handle(req, res));

    constructor(options: FakeApiOptions = {}) {
        this.limits = {
            max_content_bytes: options.maxContentBytes ?? 5 * 1024 * 1024,
            max_expiry_hours: options.maxExpiryHours ?? 8760,
        };
        this.tokens.set('token-alice', { owner: 'alice', abilities: ['pastes:create', 'pastes:read', 'pastes:revoke'] });
        this.tokens.set('token-bob', { owner: 'bob', abilities: ['pastes:create', 'pastes:read', 'pastes:revoke'] });
        this.tokens.set('token-readonly', { owner: 'alice', abilities: ['pastes:read'] });
    }

    async start(): Promise<this> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
        return this;
    }

    async close(): Promise<void> {
        this.server.closeAllConnections();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    postRequests(): RecordedRequest[] {
        return this.requests.filter(r => r.method === 'POST' && r.path === '/api/v1/pastes');
    }

    private data(paste: StoredPaste) {
        const expired = Date.parse(paste.expires_at) <= Date.now();
        return {
            slug: paste.slug,
            url: `${this.url}/p/${paste.slug}`,
            title: paste.title,
            created_at: paste.created_at,
            expires_at: paste.expires_at,
            content_format: paste.content_format,
            language: paste.language,
            visibility: paste.visibility,
            burn_after_read: paste.burn_after_read,
            encryption_mode: paste.encryption_meta.mode,
            status: paste.revoked_at ? 'revoked' : expired ? 'expired' : 'active',
            revoked_at: paste.revoked_at,
        };
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString('utf8');
        const path = (req.url ?? '').split('?')[0];
        this.requests.push({ method: req.method ?? '', path, headers: req.headers, body });

        const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
            res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
            res.end(JSON.stringify(payload));
        };

        const auth = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        const token = auth ? this.tokens.get(auth) : undefined;
        if (!token) return send(401, { message: 'Unauthenticated.' });
        const need = (ability: string) => {
            if (token.abilities.includes(ability)) return true;
            send(403, { message: 'Invalid ability provided.' });
            return false;
        };

        if (req.method === 'GET' && path === '/api/v1/limits') {
            return send(200, {
                data: {
                    max_content_bytes: this.limits.max_content_bytes,
                    default_expiry_hours: 168,
                    max_expiry_hours: this.limits.max_expiry_hours,
                    min_expiry_hours: 1,
                    content_formats: ['markdown', 'code'],
                    encryption_versions: [1],
                },
            });
        }

        if (req.method === 'POST' && path === '/api/v1/pastes') {
            if (!need('pastes:create')) return;

            const failure = this.failPosts.shift();
            if (failure) return send(failure, { message: 'Service Unavailable' }, failure === 429 ? { 'Retry-After': '0' } : {});

            let input: any;
            try {
                input = JSON.parse(body);
            } catch {
                return send(400, { message: 'Malformed JSON.' });
            }

            const errors: Record<string, string[]> = {};
            for (const field of FORBIDDEN) {
                if (field in input) errors[field] = [`The ${field} field is prohibited.`];
            }
            if (typeof input.content !== 'string' || !B64URL.test(input.content)) errors.content = ['Invalid ciphertext.'];
            const format = input.content_format ?? 'markdown';
            if (!['markdown', 'code'].includes(format)) errors.content_format = ['Invalid format.'];
            const hours = input.expires_in_hours ?? 168;
            if (!Number.isInteger(hours) || hours < 1 || hours > this.limits.max_expiry_hours) {
                errors.expires_in_hours = [`The expires in hours field must be between 1 and ${this.limits.max_expiry_hours}.`];
            }
            if (typeof input.title === 'string' && Array.from(input.title).length > 255) errors.title = ['Too long.'];
            const meta = input.encryption_meta ?? {};
            if (input.encryption_version !== 1) errors.encryption_version = ['Unsupported.'];
            if (meta.mode === 'fragment') {
                if (Object.keys(meta).sort().join() !== 'iv,mode' || meta.iv?.length !== 16) errors.encryption_meta = ['Invalid fragment envelope.'];
            } else if (meta.mode === 'password') {
                if (meta.iv?.length !== 16 || meta.salt?.length !== 22 || meta.wrapped_key?.length !== 64
                    || meta.wrap_iv?.length !== 16 || !(meta.iterations >= 100000 && meta.iterations <= 10000000)) {
                    errors.encryption_meta = ['Invalid password envelope.'];
                }
            } else {
                errors['encryption_meta.mode'] = ['Invalid mode.'];
            }
            if (Object.keys(errors).length) {
                return send(422, { message: Object.values(errors)[0][0], errors });
            }

            const bytes = Math.floor((input.content.length * 3) / 4) - 16;
            if (bytes > this.limits.max_content_bytes) {
                return send(413, {
                    message: `Content is ${bytes} bytes; the maximum is ${this.limits.max_content_bytes} bytes.`,
                    error: 'payload_too_large',
                    content_bytes: bytes,
                    max_content_bytes: this.limits.max_content_bytes,
                });
            }

            const key = req.headers['idempotency-key'] as string | undefined;
            const hash = createHash('sha256').update(body).digest('hex');
            const scoped = key ? `${token.owner}:${key}` : null;
            if (scoped && this.idempotency.has(scoped)) {
                const previous = this.idempotency.get(scoped)!;
                if (previous.hash !== hash) {
                    return send(409, { message: 'This Idempotency-Key was already used with a different request.', error: 'idempotency_key_reused' });
                }
                if (this.dropPostResponses > 0) {
                    this.dropPostResponses--;
                    req.socket.destroy();
                    return;
                }
                return send(200, { data: this.data(this.pastes.get(previous.slug)!) }, { 'Idempotent-Replayed': 'true' });
            }

            const created = new Date(Math.floor(Date.now() / 1000) * 1000);
            const slug = randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 16);
            const paste: StoredPaste = {
                slug,
                owner: token.owner,
                title: input.title ?? null,
                content: input.content,
                content_format: format,
                language: format === 'markdown' ? 'markdown' : (input.language ?? 'text'),
                visibility: input.visibility ?? 'unlisted',
                burn_after_read: input.burn_after_read ?? false,
                encryption_meta: meta,
                created_at: isoMicro(created),
                expires_at: isoMicro(new Date(created.getTime() + hours * 3_600_000)),
                revoked_at: null,
            };
            this.pastes.set(slug, paste);
            if (scoped) this.idempotency.set(scoped, { hash, slug });

            if (this.dropPostResponses > 0) {
                this.dropPostResponses--;
                req.socket.destroy();
                return;
            }

            return send(201, { data: this.data(paste) });
        }

        const match = path.match(/^\/api\/v1\/pastes\/([A-Za-z0-9]+)$/);
        if (match && (req.method === 'GET' || req.method === 'DELETE')) {
            if (!need(req.method === 'GET' ? 'pastes:read' : 'pastes:revoke')) return;
            const paste = this.pastes.get(match[1]);
            if (!paste || paste.owner !== token.owner) return send(404, { message: 'Paste not found.' });
            if (req.method === 'DELETE' && !paste.revoked_at) {
                paste.revoked_at = isoMicro(new Date());
                paste.content = null;
            }
            return send(200, { data: this.data(paste) });
        }

        send(404, { message: 'Not Found' });
    }
}
