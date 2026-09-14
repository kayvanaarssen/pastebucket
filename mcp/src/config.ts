import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PastebucketError } from './errors.ts';

export interface PastebucketConfig {
    /** Origin plus optional path prefix, without a trailing slash. */
    baseUrl: string;
    token: string;
    /** Where recovery data for interrupted publishes is kept. */
    stateDir: string;
}

type Env = Record<string, string | undefined>;

/**
 * Plain http is refused except on loopback. The token travels in a header on
 * every request, and a Bearer token over an untrusted network is a password in
 * the clear -- the content is ciphertext, the token is not.
 */
function isLoopback(hostname: string): boolean {
    return hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || /^127(?:\.\d{1,3}){3}$/.test(hostname)
        || hostname === '[::1]';
}

export function normalizeBaseUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        throw new PastebucketError(`PASTEBUCKET_URL is not a valid URL.`, 'config');
    }

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
        throw new PastebucketError(
            'PASTEBUCKET_URL must use https (plain http is only accepted for localhost).',
            'config',
        );
    }

    if (url.search || url.hash || url.username || url.password) {
        throw new PastebucketError(
            'PASTEBUCKET_URL must be a plain base URL without credentials, query string or fragment.',
            'config',
        );
    }

    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function defaultStateDir(env: Env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
    if (platform === 'win32') {
        return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pastebucket');
    }
    return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'pastebucket');
}

export function loadConfig(env: Env = process.env): PastebucketConfig {
    if (!env.PASTEBUCKET_URL) {
        throw new PastebucketError(
            'PASTEBUCKET_URL is not set. Point it at your PasteBucket instance, e.g. https://paste.ictwebsolution.nl.',
            'config',
        );
    }

    let token = env.PASTEBUCKET_API_TOKEN?.trim() ?? '';
    if (!token && env.PASTEBUCKET_API_TOKEN_FILE) {
        try {
            token = readFileSync(env.PASTEBUCKET_API_TOKEN_FILE, 'utf8').trim();
        } catch {
            throw new PastebucketError('PASTEBUCKET_API_TOKEN_FILE could not be read.', 'config');
        }
    }
    if (!token) {
        throw new PastebucketError(
            'No API token configured. Create one on your PasteBucket Profile page and set '
                + 'PASTEBUCKET_API_TOKEN (or PASTEBUCKET_API_TOKEN_FILE).',
            'config',
        );
    }

    return {
        baseUrl: normalizeBaseUrl(env.PASTEBUCKET_URL),
        token,
        stateDir: env.PASTEBUCKET_STATE_DIR || defaultStateDir(env),
    };
}
