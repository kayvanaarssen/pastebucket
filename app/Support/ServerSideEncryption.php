<?php

namespace App\Support;

use RuntimeException;

/**
 * The paste encryption envelope, produced on the server.
 *
 * Only the remote MCP endpoint uses this. A client like ChatGPT cannot run the
 * browser/Node crypto core, so it hands this server the plaintext and the
 * server encrypts it before anything is stored. That is a weaker guarantee
 * than every other route, where the server never sees plaintext or keys: here
 * the plaintext and the fragment key exist in this PHP process for the length
 * of one request. They are never written to the database, the session or the
 * logs, and the key is returned to the caller only inside the share link.
 *
 * This is not a new protocol. It reproduces resources/js/lib/crypto-core.ts
 * byte for byte, so the website decrypts these pastes through its normal path:
 *
 *   content     AES-256-GCM, random 256-bit key, 12-byte IV, 16-byte tag
 *               appended to the ciphertext, base64url without padding
 *   fragment    the raw 32-byte key, base64url, placed after #k= in the link
 *   password    PBKDF2-HMAC-SHA256 (600,000 iterations, 16-byte salt) derives
 *               a key-encryption key; the content key is AES-GCM-encrypted
 *               under it (= WebCrypto wrapKey 'raw') with its own 12-byte IV
 *
 * tests/Feature/Mcp/ServerSideEncryptionInteropTest.php decrypts this output
 * with crypto-core.ts in Node to keep the two implementations honest.
 */
final class ServerSideEncryption
{
    public const PBKDF2_ITERATIONS = 600_000;

    private const CIPHER = 'aes-256-gcm';

    private const KEY_BYTES = 32;

    private const IV_BYTES = 12;

    private const SALT_BYTES = 16;

    private const TAG_BYTES = 16;

    /**
     * @return array{content: string, encryption_version: int, encryption_meta: array<string, int|string>, fragment_key: string|null}
     */
    public static function encrypt(string $plaintext, ?string $password = null): array
    {
        $cek = random_bytes(self::KEY_BYTES);
        $iv = random_bytes(self::IV_BYTES);

        $meta = ['mode' => 'fragment', 'iv' => self::base64Url($iv)];
        $content = self::base64Url(self::seal($plaintext, $cek, $iv));
        $fragmentKey = null;

        if ($password !== null && $password !== '') {
            $salt = random_bytes(self::SALT_BYTES);
            $wrapIv = random_bytes(self::IV_BYTES);
            $kek = hash_pbkdf2('sha256', $password, $salt, self::PBKDF2_ITERATIONS, self::KEY_BYTES, true);

            $meta = [
                'mode' => 'password',
                'iv' => $meta['iv'],
                'salt' => self::base64Url($salt),
                'iterations' => self::PBKDF2_ITERATIONS,
                'wrapped_key' => self::base64Url(self::seal($cek, $kek, $wrapIv)),
                'wrap_iv' => self::base64Url($wrapIv),
            ];

            sodium_memzero($kek);
        } else {
            $fragmentKey = self::base64Url($cek);
        }

        sodium_memzero($cek);

        return [
            'content' => $content,
            'encryption_version' => EncryptionEnvelope::VERSION,
            'encryption_meta' => $meta,
            'fragment_key' => $fragmentKey,
        ];
    }

    /** AES-GCM with the tag appended, the layout WebCrypto produces and expects. */
    private static function seal(string $data, string $key, string $iv): string
    {
        $tag = '';
        $ciphertext = openssl_encrypt($data, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag, '', self::TAG_BYTES);

        if ($ciphertext === false || strlen($tag) !== self::TAG_BYTES) {
            throw new RuntimeException('Encryption failed.');
        }

        return $ciphertext.$tag;
    }

    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
