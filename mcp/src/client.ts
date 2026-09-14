import { randomUUID } from 'node:crypto';
import {
    encryptContent,
    ENCRYPTION_VERSION,
    type EncryptionMeta,
} from '../../resources/js/lib/crypto-core.ts';
import type { PastebucketConfig } from './config.ts';
import { isTransient, PastebucketError } from './errors.ts';
import { errorFromReply, PastebucketHttp, type ApiReply, type HttpOptions } from './http.ts';
import { RecoveryStore, RECOVERY_LIFETIME_MS } from './recovery.ts';

export const DEFAULT_TITLE = 'Shared document';
export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_TITLE_CHARACTERS = 255;
export const MIN_PASSWORD_LENGTH = 8;

export type ContentFormat = 'markdown' | 'code';

export interface Limits {
    max_content_bytes: number;
    default_expiry_hours: number;
    max_expiry_hours: number;
    min_expiry_hours: number;
    content_formats: string[];
    encryption_versions: number[];
}

/** A paste as the API describes it. `url` never carries a key. */
export interface PasteData {
    slug: string;
    url: string;
    title: string | null;
    created_at: string;
    expires_at: string | null;
    content_format: string;
    language: string | null;
    visibility: string;
    burn_after_read: boolean;
    encryption_mode: 'fragment' | 'password';
    status: 'active' | 'expired' | 'revoked';
    revoked_at: string | null;
}

export interface PublishInput {
    /** Published byte for byte: never trimmed, normalised or truncated. */
    content: string;
    title?: string | null;
    contentFormat?: ContentFormat;
    /** Highlighting language for the `code` format. Defaults to "text". */
    language?: string | null;
    expiresInDays?: number;
    expiresInHours?: number;
    password?: string | null;
}

export interface PublishResult {
    /** The customer link. Includes the decryption key in fragment mode. */
    share_url: string;
    slug: string;
    title: string | null;
    created_at: string;
    expires_at: string;
    content_format: string;
    password_protected: boolean;
    content_bytes: number;
    /** True when the server recognised a retry and returned the original paste. */
    replayed: boolean;
}

export interface ClientOptions extends HttpOptions {
    now?: () => number;
}

const SLUG_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * Accept a bare slug or a paste URL. Only the slug is ever used, so pasting a
 * full share link here does not send its key anywhere.
 */
export function slugFrom(input: string): string {
    const trimmed = input.trim();
    const fromUrl = trimmed.match(/\/(?:p)\/([A-Za-z0-9]+)(?:[/?#]|$)/);
    const slug = fromUrl ? fromUrl[1] : trimmed;
    if (!SLUG_PATTERN.test(slug)) {
        throw new PastebucketError('That is not a valid paste slug.', 'invalid_input');
    }
    return slug;
}

function isPasteData(value: any): value is PasteData {
    return value && typeof value.slug === 'string' && typeof value.url === 'string'
        && typeof value.created_at === 'string' && typeof value.status === 'string';
}

export class PastebucketClient {
    readonly config: PastebucketConfig;
    private readonly http: PastebucketHttp;
    private readonly recovery: RecoveryStore;
    private readonly now: () => number;
    private limitsCache: Limits | null = null;

    constructor(config: PastebucketConfig, options: ClientOptions = {}) {
        this.config = config;
        this.now = options.now ?? Date.now;
        this.http = new PastebucketHttp(config.baseUrl, config.token, options);
        this.recovery = new RecoveryStore(config.stateDir, this.now);
    }

    async limits(): Promise<Limits> {
        if (this.limitsCache) return this.limitsCache;
        const reply = await this.http.request('GET', '/limits');
        if (reply.status !== 200 || typeof reply.json?.data?.max_content_bytes !== 'number') {
            throw reply.status === 200
                ? new PastebucketError('PasteBucket returned an unexpected limits response.', 'protocol', 200)
                : errorFromReply(reply);
        }
        this.limitsCache = reply.json.data as Limits;
        return this.limitsCache;
    }

    /**
     * Encrypt locally and publish.
     *
     * Order matters: every refusal that can be decided locally (empty content,
     * title length, expiry range, size) happens before encryption and before
     * any request, so a rejected publish leaves nothing behind anywhere.
     */
    async publish(input: PublishInput): Promise<PublishResult> {
        const content = input.content;
        if (typeof content !== 'string' || content.trim() === '') {
            throw new PastebucketError('There is no content to publish.', 'invalid_input');
        }

        const title = input.title && input.title.trim() !== '' ? input.title : DEFAULT_TITLE;
        const titleLength = Array.from(title).length;
        if (titleLength > MAX_TITLE_CHARACTERS) {
            throw new PastebucketError(
                `The title is ${titleLength} characters; the maximum is ${MAX_TITLE_CHARACTERS}. It was not shortened.`,
                'invalid_input',
            );
        }

        const password = input.password ?? null;
        if (password !== null && Array.from(password).length < MIN_PASSWORD_LENGTH) {
            throw new PastebucketError(
                `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
                'invalid_input',
            );
        }

        const format: ContentFormat = input.contentFormat ?? 'markdown';
        const language = format === 'code' ? (input.language || 'text') : null;
        if (language !== null && language.length > 50) {
            throw new PastebucketError('The language name may be at most 50 characters.', 'invalid_input');
        }

        const limits = await this.limits();
        const hours = this.resolveExpiryHours(input, limits);

        const contentBytes = new TextEncoder().encode(content).length;
        if (contentBytes > limits.max_content_bytes) {
            throw new PastebucketError(
                `Content is ${contentBytes} bytes; the maximum is ${limits.max_content_bytes} bytes. `
                    + 'Nothing was published or truncated.',
                'too_large',
            );
        }

        await this.recovery.purge();

        const fingerprint = await this.recovery.fingerprint([
            this.config.baseUrl, title, content, format, language, hours, password,
        ]);

        let record = await this.recovery.load(fingerprint);
        if (!record) {
            const encrypted = await encryptContent(content, password);
            const body: Record<string, unknown> = {
                title,
                content: encrypted.content,
                content_format: format,
                visibility: 'unlisted',
                expires_in_hours: hours,
                burn_after_read: false,
                encryption_version: encrypted.encryption_version,
                encryption_meta: encrypted.encryption_meta satisfies EncryptionMeta,
            };
            if (language !== null) body.language = language;

            record = {
                version: 1,
                fingerprint,
                idempotency_key: `pb-${randomUUID()}`,
                created_at: new Date(this.now()).toISOString(),
                body: JSON.stringify(body),
                fragment_key: encrypted.fragmentKey ?? null,
            };
            await this.recovery.save(record);
        }

        let reply: ApiReply;
        try {
            reply = await this.http.request('POST', '/pastes', {
                body: record.body,
                idempotencyKey: record.idempotency_key,
            });
        } catch (error) {
            if (isTransient(error)) {
                const hoursLeft = Math.round(RECOVERY_LIFETIME_MS / 3_600_000);
                throw new PastebucketError(
                    `${(error as Error).message} The paste may or may not have been stored. The encrypted payload `
                        + `is kept locally for ${hoursLeft} hours: publishing the identical content again reuses it, `
                        + 'so a retry cannot create a duplicate or a link with the wrong key.',
                    (error as PastebucketError).code,
                    (error as PastebucketError).status,
                );
            }
            throw error;
        }

        if (reply.status !== 200 && reply.status !== 201) {
            // A definitive refusal: this exact payload will never be accepted,
            // so there is nothing worth recovering.
            await this.recovery.remove(fingerprint);
            throw errorFromReply(reply, 'pastes:create');
        }

        const data = reply.json?.data;
        const expectedMode = record.fragment_key ? 'fragment' : 'password';
        if (!isPasteData(data) || data.url.includes('#') || data.encryption_mode !== expectedMode || !data.expires_at) {
            // Handing out a link we cannot vouch for is worse than failing.
            throw new PastebucketError('PasteBucket returned an unexpected response; no link was produced.', 'protocol', reply.status);
        }

        await this.recovery.remove(fingerprint);

        return {
            share_url: record.fragment_key ? `${data.url}#k=${record.fragment_key}` : data.url,
            slug: data.slug,
            title: data.title,
            created_at: data.created_at,
            expires_at: data.expires_at,
            content_format: data.content_format,
            password_protected: expectedMode === 'password',
            content_bytes: contentBytes,
            replayed: reply.status === 200 && reply.headers.get('idempotent-replayed') === 'true',
        };
    }

    async status(slugOrUrl: string): Promise<PasteData> {
        return this.pasteRequest('GET', slugOrUrl, 'pastes:read');
    }

    async revoke(slugOrUrl: string): Promise<PasteData> {
        return this.pasteRequest('DELETE', slugOrUrl, 'pastes:revoke');
    }

    private async pasteRequest(method: 'GET' | 'DELETE', slugOrUrl: string, ability: string): Promise<PasteData> {
        const slug = slugFrom(slugOrUrl);
        const reply = await this.http.request(method, `/pastes/${slug}`);
        if (reply.status !== 200) throw errorFromReply(reply, ability);
        if (!isPasteData(reply.json?.data)) {
            throw new PastebucketError('PasteBucket returned an unexpected response.', 'protocol', reply.status);
        }
        return reply.json.data;
    }

    private resolveExpiryHours(input: PublishInput, limits: Limits): number {
        if (input.expiresInDays !== undefined && input.expiresInHours !== undefined) {
            throw new PastebucketError('Give the expiry in days or in hours, not both.', 'invalid_input');
        }

        const maxDays = Math.floor(limits.max_expiry_hours / 24);

        if (input.expiresInHours !== undefined) {
            const hours = input.expiresInHours;
            if (!Number.isInteger(hours) || hours < limits.min_expiry_hours || hours > limits.max_expiry_hours) {
                throw new PastebucketError(
                    `Expiry must be a whole number of hours between ${limits.min_expiry_hours} and ${limits.max_expiry_hours}.`,
                    'invalid_input',
                );
            }
            return hours;
        }

        // Missing means seven days -- never "no expiry".
        const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
        if (!Number.isInteger(days) || days < 1 || days > maxDays) {
            throw new PastebucketError(
                `Expiry must be a whole number of days between 1 and ${maxDays} for this account.`,
                'invalid_input',
            );
        }
        return days * 24;
    }
}
