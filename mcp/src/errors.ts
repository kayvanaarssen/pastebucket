/**
 * One error type for everything the client can refuse or fail at.
 *
 * Messages are shown verbatim to the user by the CLI and to the assistant by
 * the MCP server, so they are written to be read -- and they are built only
 * from server replies, counts and field names. Never from the request body,
 * the token, the fragment key or a password: an error is the one output that
 * tends to get pasted into bug reports and chat logs.
 */

export type ErrorCode =
    | 'config'
    | 'invalid_input'
    | 'too_large'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'validation'
    | 'rate_limited'
    | 'unavailable'
    | 'network'
    | 'protocol';

export class PastebucketError extends Error {
    readonly code: ErrorCode;
    readonly status: number | undefined;

    constructor(message: string, code: ErrorCode, status?: number) {
        super(message);
        this.name = 'PastebucketError';
        this.code = code;
        this.status = status;
    }
}

/** Errors worth retrying with the same idempotency key and ciphertext. */
export function isTransient(error: unknown): boolean {
    return error instanceof PastebucketError
        && (error.code === 'network' || error.code === 'unavailable' || error.code === 'rate_limited');
}
