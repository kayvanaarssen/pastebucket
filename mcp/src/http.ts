import { PastebucketError } from './errors.ts';

export interface HttpOptions {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    /** Total attempts per request, including the first. */
    maxAttempts?: number;
    timeoutMs?: number;
    /** Upper bound on how long a Retry-After header may make us wait. */
    maxRetryAfterMs?: number;
}

export interface ApiReply {
    status: number;
    headers: Headers;
    json: any;
}

interface RequestOptions {
    body?: string;
    idempotencyKey?: string;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function retryAfterMs(headers: Headers, cap: number): number | null {
    const value = headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), cap) : null;
}

/**
 * Thin JSON transport with bounded retries.
 *
 * A retry resends the exact same bytes under the exact same Idempotency-Key.
 * That is what makes retrying a publish safe: the server either never saw the
 * first attempt, or it replays the paste it already stored -- whose ciphertext
 * is the one the caller's fragment key opens.
 */
export class PastebucketHttp {
    private readonly apiBase: string;
    private readonly token: string;
    private readonly fetchImpl: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly maxAttempts: number;
    private readonly timeoutMs: number;
    private readonly maxRetryAfterMs: number;

    constructor(baseUrl: string, token: string, options: HttpOptions = {}) {
        this.apiBase = `${baseUrl}/api/v1`;
        this.token = token;
        this.fetchImpl = options.fetch ?? fetch;
        this.sleep = options.sleep ?? defaultSleep;
        this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
        this.timeoutMs = options.timeoutMs ?? 120_000;
        this.maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
    }

    async request(method: 'GET' | 'POST' | 'DELETE', path: string, options: RequestOptions = {}): Promise<ApiReply> {
        const headers: Record<string, string> = {
            Accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
        };
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';
        if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

        let lastReply: ApiReply | null = null;

        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            const isLast = attempt === this.maxAttempts;
            const backoff = 500 * 2 ** (attempt - 1);

            let response: Response;
            try {
                response = await this.fetchImpl(`${this.apiBase}${path}`, {
                    method,
                    headers,
                    body: options.body,
                    signal: AbortSignal.timeout(this.timeoutMs),
                    redirect: 'error',
                });
            } catch {
                // The underlying error can name the host and port but nothing
                // secret; it is still not echoed, to keep messages uniform.
                lastReply = null;
                if (isLast) break;
                await this.sleep(backoff);
                continue;
            }

            const text = await response.text().catch(() => '');
            let json: any = null;
            try {
                json = text ? JSON.parse(text) : null;
            } catch {
                json = null;
            }
            const reply: ApiReply = { status: response.status, headers: response.headers, json };

            if (!RETRYABLE_STATUSES.has(response.status)) return reply;

            lastReply = reply;
            if (isLast) break;
            await this.sleep(retryAfterMs(response.headers, this.maxRetryAfterMs) ?? backoff);
        }

        if (lastReply) throw errorFromReply(lastReply);

        throw new PastebucketError(
            `Could not reach PasteBucket after ${this.maxAttempts} attempt(s) (network error or timeout).`,
            'network',
        );
    }
}

/** Turn a non-2xx reply into a readable error, using only server-provided text. */
export function errorFromReply(reply: ApiReply, ability?: string): PastebucketError {
    const serverMessage = typeof reply.json?.message === 'string' ? reply.json.message : null;
    const status = reply.status;

    switch (status) {
        case 401:
            return new PastebucketError(
                'PasteBucket rejected the API token: it is missing, expired or revoked. '
                    + 'Create a new token on your Profile page.',
                'unauthenticated',
                status,
            );
        case 403:
            return new PastebucketError(
                `The API token is not allowed to do this${ability ? ` (needs the "${ability}" ability)` : ''}.`
                    + (serverMessage ? ` Server: ${serverMessage}` : ''),
                'forbidden',
                status,
            );
        case 404:
            return new PastebucketError(
                'Paste not found. It may never have existed, belong to another account, '
                    + 'or have been removed after it expired.',
                'not_found',
                status,
            );
        case 409:
            return new PastebucketError(
                serverMessage ?? 'The request conflicts with an earlier one.',
                'conflict',
                status,
            );
        case 413: {
            const bytes = reply.json?.content_bytes;
            const max = reply.json?.max_content_bytes;
            return new PastebucketError(
                typeof bytes === 'number' && typeof max === 'number'
                    ? `Content is ${bytes} bytes; the maximum is ${max} bytes. Nothing was published or truncated.`
                    : `${serverMessage ?? 'The content is too large.'} Nothing was published or truncated.`,
                'too_large',
                status,
            );
        }
        case 422: {
            const errors = reply.json?.errors && typeof reply.json.errors === 'object'
                ? Object.entries(reply.json.errors as Record<string, unknown>)
                    .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(' ') : String(messages)}`)
                : [];
            return new PastebucketError(
                `PasteBucket refused the request: ${serverMessage ?? 'validation failed.'}`
                    + (errors.length ? ` (${errors.join('; ')})` : ''),
                'validation',
                status,
            );
        }
        case 429:
            return new PastebucketError(
                'PasteBucket is rate limiting these requests. Wait a minute and try again.',
                'rate_limited',
                status,
            );
        default:
            if (status >= 500) {
                return new PastebucketError(
                    `PasteBucket is unavailable right now (HTTP ${status}).`,
                    'unavailable',
                    status,
                );
            }
            return new PastebucketError(
                `Unexpected response from PasteBucket (HTTP ${status})${serverMessage ? `: ${serverMessage}` : '.'}`,
                'protocol',
                status,
            );
    }
}
