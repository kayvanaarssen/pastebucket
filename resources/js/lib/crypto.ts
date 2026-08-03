/**
 * End-to-end encryption for paste content.
 *
 * Content is encrypted with a random 256-bit Content Encryption Key (CEK) using
 * AES-GCM. The CEK never reaches the server. It travels one of two ways:
 *
 *   fragment mode - the CEK is base64url-encoded into the URL fragment (#k=...),
 *                   which browsers never transmit in the request.
 *   password mode - the CEK is wrapped with a key derived from the paste
 *                   password via PBKDF2, and the wrapped bytes are stored
 *                   server-side. The password itself is never sent.
 *
 * Wrapping the CEK rather than deriving it straight from the password means a
 * password change re-wraps 32 bytes instead of re-encrypting the whole paste,
 * and both modes decrypt through one code path.
 *
 * Threat model: this protects against a database dump and a passive operator.
 * It does not protect against a compromised server that serves modified
 * JavaScript, which is the standing limit of browser-delivered crypto.
 */

/** Bumped only on a breaking envelope change, so old pastes stay readable. */
export const ENCRYPTION_VERSION = 1;

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. */
const PBKDF2_ITERATIONS = 600_000;

const AES_KEY_BITS = 256;
const IV_BYTES = 12; // 96 bits, the size AES-GCM is specified for
const SALT_BYTES = 16;

export type EncryptionMode = 'fragment' | 'password';

/**
 * Non-secret encryption parameters, stored alongside the ciphertext. Everything
 * here is safe to hand to the server; the secret is the CEK, which is either in
 * the URL fragment or locked behind the password.
 */
export interface EncryptionMeta {
    mode: EncryptionMode;
    /** AES-GCM IV for the content, base64url. */
    iv: string;
    /** PBKDF2 salt, base64url. Password mode only. */
    salt?: string;
    iterations?: number;
    /** CEK wrapped under the password-derived key, base64url. Password mode only. */
    wrapped_key?: string;
    /** IV used for the wrap operation, base64url. Password mode only. */
    wrap_iv?: string;
}

export interface EncryptedPaste {
    /** base64url ciphertext, stored in the existing `content` column. */
    content: string;
    encryption_version: number;
    encryption_meta: EncryptionMeta;
    /** Present in fragment mode only — belongs in the URL, never in a request. */
    fragmentKey?: string;
}

/** Thrown when decryption fails. Never distinguishes wrong-key from corrupt. */
export class DecryptionError extends Error {
    constructor(message = 'Unable to decrypt this paste.') {
        super(message);
        this.name = 'DecryptionError';
    }
}

/* -------------------------------------------------------------------------- */
/* base64url                                                                   */
/* -------------------------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function randomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
}

/* -------------------------------------------------------------------------- */
/* key handling                                                                */
/* -------------------------------------------------------------------------- */

async function generateCek(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: AES_KEY_BITS }, true, [
        'encrypt',
        'decrypt',
    ]);
}

async function exportCek(key: CryptoKey): Promise<string> {
    return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

async function importCek(rawKey: string): Promise<CryptoKey> {
    let bytes: Uint8Array;
    try {
        bytes = fromBase64Url(rawKey);
    } catch {
        throw new DecryptionError('The decryption key in this link is malformed.');
    }
    if (bytes.length !== AES_KEY_BITS / 8) {
        throw new DecryptionError('The decryption key in this link is malformed.');
    }
    return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'AES-GCM' }, true, [
        'encrypt',
        'decrypt',
    ]);
}

/** Derive the key-encryption key that wraps the CEK in password mode. */
async function deriveKek(
    password: string,
    salt: Uint8Array,
    iterations: number,
): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: AES_KEY_BITS },
        false,
        ['wrapKey', 'unwrapKey'],
    );
}

/* -------------------------------------------------------------------------- */
/* encrypt / decrypt                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Encrypt paste content. Pass a password to produce a password-mode paste;
 * omit it and the returned `fragmentKey` must be placed in the URL fragment or
 * the paste becomes permanently unreadable.
 */
export async function encryptContent(
    plaintext: string,
    password?: string | null,
): Promise<EncryptedPaste> {
    const cek = await generateCek();
    const iv = randomBytes(IV_BYTES);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        cek,
        new TextEncoder().encode(plaintext),
    );

    const meta: EncryptionMeta = { mode: 'fragment', iv: toBase64Url(iv) };
    const result: EncryptedPaste = {
        content: toBase64Url(new Uint8Array(ciphertext)),
        encryption_version: ENCRYPTION_VERSION,
        encryption_meta: meta,
    };

    if (password) {
        const salt = randomBytes(SALT_BYTES);
        const wrapIv = randomBytes(IV_BYTES);
        const kek = await deriveKek(password, salt, PBKDF2_ITERATIONS);
        const wrapped = await crypto.subtle.wrapKey('raw', cek, kek, {
            name: 'AES-GCM',
            iv: wrapIv as BufferSource,
        });

        meta.mode = 'password';
        meta.salt = toBase64Url(salt);
        meta.iterations = PBKDF2_ITERATIONS;
        meta.wrapped_key = toBase64Url(new Uint8Array(wrapped));
        meta.wrap_iv = toBase64Url(wrapIv);
    } else {
        result.fragmentKey = await exportCek(cek);
    }

    return result;
}

/** Recover the CEK from a password. Throws DecryptionError if the password is wrong. */
export async function unwrapCekWithPassword(
    password: string,
    meta: EncryptionMeta,
): Promise<CryptoKey> {
    if (!meta.salt || !meta.wrapped_key || !meta.wrap_iv) {
        throw new DecryptionError('This paste is missing its password parameters.');
    }

    const kek = await deriveKek(
        password,
        fromBase64Url(meta.salt),
        meta.iterations ?? PBKDF2_ITERATIONS,
    );

    try {
        // AES-GCM authenticates on unwrap, so a wrong password fails here rather
        // than producing a garbage key — this is the wrong-password signal.
        return await crypto.subtle.unwrapKey(
            'raw',
            fromBase64Url(meta.wrapped_key) as BufferSource,
            kek,
            { name: 'AES-GCM', iv: fromBase64Url(meta.wrap_iv) as BufferSource },
            { name: 'AES-GCM', length: AES_KEY_BITS },
            true,
            ['encrypt', 'decrypt'],
        );
    } catch {
        throw new DecryptionError('Incorrect password.');
    }
}

/**
 * Decrypt with a CEK already in hand. Callers that unwrapped a key from a
 * password use this to avoid paying for a second 600k-iteration derivation.
 */
export async function decryptWithCek(
    ciphertext: string,
    meta: EncryptionMeta,
    cek: CryptoKey,
): Promise<string> {
    try {
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64Url(meta.iv) as BufferSource },
            cek,
            fromBase64Url(ciphertext) as BufferSource,
        );
        return new TextDecoder().decode(plaintext);
    } catch {
        throw new DecryptionError();
    }
}

/** Decrypt a fragment-mode paste using the key from the URL fragment. */
export async function decryptWithFragmentKey(
    ciphertext: string,
    meta: EncryptionMeta,
    fragmentKey: string,
): Promise<string> {
    return decryptWithCek(ciphertext, meta, await importCek(fragmentKey));
}

/** Decrypt a password-mode paste. Throws DecryptionError on a wrong password. */
export async function decryptWithPassword(
    ciphertext: string,
    meta: EncryptionMeta,
    password: string,
): Promise<string> {
    return decryptWithCek(ciphertext, meta, await unwrapCekWithPassword(password, meta));
}

/**
 * Re-encrypt content under an existing CEK, so editing a paste does not
 * invalidate links that already carry its key.
 */
export async function reEncryptWithCek(
    plaintext: string,
    cek: CryptoKey,
): Promise<{ content: string; iv: string }> {
    const iv = randomBytes(IV_BYTES);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        cek,
        new TextEncoder().encode(plaintext),
    );
    return { content: toBase64Url(new Uint8Array(ciphertext)), iv: toBase64Url(iv) };
}

export async function importFragmentKey(rawKey: string): Promise<CryptoKey> {
    return importCek(rawKey);
}

export async function exportFragmentKey(key: CryptoKey): Promise<string> {
    return exportCek(key);
}

/* -------------------------------------------------------------------------- */
/* URL fragment                                                                */
/* -------------------------------------------------------------------------- */

/** Read the CEK out of `#k=...`. Returns null when absent. */
export function readKeyFromFragment(): string | null {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return null;
    const key = new URLSearchParams(hash).get('k');
    return key && key.length > 0 ? key : null;
}

/**
 * Attach the key to the current URL without a navigation or history entry.
 * Used after create, where the server redirect cannot carry a fragment.
 */
export function writeKeyToFragment(key: string): void {
    window.history.replaceState(null, '', `${window.location.pathname}#k=${key}`);
}

/**
 * Hand the content key from the create page to the view page.
 *
 * After a create, Inertia mounts PasteView *before* the create page's onSuccess
 * callback runs, so a key written to the fragment there arrives too late for the
 * view to find on mount -- and replaceState fires no hashchange to recover with.
 * The slug isn't known until the response lands, so the key is stashed under a
 * fixed name before navigating and claimed once on the other side.
 *
 * sessionStorage is same-origin and tab-scoped, and the entry is deleted on
 * read. That is the same exposure the URL fragment already carries.
 */
const PENDING_KEY_STORAGE = 'pastebucket:pending_key';

export function stashPendingKey(key: string): void {
    try {
        window.sessionStorage.setItem(PENDING_KEY_STORAGE, key);
    } catch {
        // Private browsing modes can refuse writes. The fragment write in
        // onSuccess is still attempted, so this is a degraded path, not a broken one.
    }
}

/** Read and clear the stashed key. Returns null when there is nothing pending. */
export function consumePendingKey(): string | null {
    try {
        const key = window.sessionStorage.getItem(PENDING_KEY_STORAGE);
        if (key) window.sessionStorage.removeItem(PENDING_KEY_STORAGE);
        return key;
    } catch {
        return null;
    }
}

/** Absolute shareable URL including the key. Without the fragment it is useless. */
export function buildShareUrl(slug: string, key: string | null): string {
    const base = `${window.location.origin}/p/${slug}`;
    return key ? `${base}#k=${key}` : base;
}

/** True when the browser can do the crypto we need (WebCrypto requires a secure context). */
export function isCryptoAvailable(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}
