/**
 * Browser half of end-to-end encryption.
 *
 * The cryptography itself lives in crypto-core.ts, which the local MCP client
 * imports too, so a paste encrypted in a terminal and a paste encrypted on the
 * website go through one implementation. What remains here needs `window`:
 * the URL fragment, the short-link path and the create-to-view key handoff.
 */

export * from './crypto-core';

import { shareUrlFor } from './crypto-core';

/* -------------------------------------------------------------------------- */
/* short links                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Read the code back out of `/s/{code}`.
 *
 * Unlike a fragment this *is* sent to the server, which is the trade the short
 * link makes. It is read from the path rather than passed through props so the
 * server never has to echo it back.
 */
export function readShortCodeFromPath(): string | null {
    const match = window.location.pathname.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
    return match ? match[1] : null;
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
    return shareUrlFor(window.location.origin, slug, key);
}
