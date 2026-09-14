<?php

namespace App\Support;

/**
 * Validation for the client-supplied encryption envelope, shared by the browser
 * routes and the API.
 *
 * These are the non-secret parameters needed to decrypt. The content key is
 * absent by design: it lives in the URL fragment or is wrapped under the user's
 * password, and either way the server must never be able to derive it.
 */
final class EncryptionEnvelope
{
    public const VERSION = 1;

    /** AES-GCM appends a 128-bit tag, so ciphertext is always plaintext + 16 bytes. */
    public const GCM_TAG_BYTES = 16;

    private const BASE64URL = '/^[A-Za-z0-9_-]+$/';

    /**
     * The rules the website has always applied. Kept as they were: legacy
     * plaintext pastes still arrive through these routes without an envelope.
     *
     * @return array<string, string>
     */
    public static function browserRules(): array
    {
        return [
            'encryption_version' => 'nullable|integer|in:1',
            'encryption_meta' => 'nullable|array|required_with:encryption_version',
            'encryption_meta.mode' => 'required_with:encryption_meta|in:fragment,password',
            'encryption_meta.iv' => 'required_with:encryption_meta|string|max:64',
            'encryption_meta.salt' => 'nullable|string|max:64',
            'encryption_meta.iterations' => 'nullable|integer|min:100000|max:10000000',
            'encryption_meta.wrapped_key' => 'nullable|string|max:256',
            'encryption_meta.wrap_iv' => 'nullable|string|max:64',
        ];
    }

    /**
     * The rules for integration publishes: a complete, well-formed envelope or
     * nothing. Lengths are exact because the byte sizes are fixed by the scheme
     * in resources/js/lib/crypto-core.ts (12-byte IVs, 16-byte salt, a 32-byte
     * key wrapped with a 16-byte tag).
     *
     * @return array<string, array<int, string>|string>
     */
    public static function strictRules(): array
    {
        $b64 = fn (int $chars) => 'regex:/^[A-Za-z0-9_-]{'.$chars.'}$/';

        return [
            'content' => ['required', 'string', 'min:22', 'regex:'.self::BASE64URL],
            'encryption_version' => ['required', 'integer', 'in:'.self::VERSION],
            'encryption_meta' => ['required', 'array:mode,iv,salt,iterations,wrapped_key,wrap_iv'],
            'encryption_meta.mode' => ['required', 'string', 'in:fragment,password'],
            'encryption_meta.iv' => ['required', 'string', $b64(16)],
            'encryption_meta.salt' => ['required_if:encryption_meta.mode,password', 'prohibited_if:encryption_meta.mode,fragment', 'string', $b64(22)],
            'encryption_meta.iterations' => ['required_if:encryption_meta.mode,password', 'prohibited_if:encryption_meta.mode,fragment', 'integer', 'min:100000', 'max:10000000'],
            'encryption_meta.wrapped_key' => ['required_if:encryption_meta.mode,password', 'prohibited_if:encryption_meta.mode,fragment', 'string', $b64(64)],
            'encryption_meta.wrap_iv' => ['required_if:encryption_meta.mode,password', 'prohibited_if:encryption_meta.mode,fragment', 'string', $b64(16)],
        ];
    }

    /**
     * Exact plaintext size behind an unpadded base64url AES-GCM ciphertext.
     * Mirrors plaintextBytesForCiphertext() in crypto-core.ts.
     */
    public static function plaintextBytes(string $ciphertext): int
    {
        return max(0, intdiv(strlen($ciphertext) * 3, 4) - self::GCM_TAG_BYTES);
    }
}
