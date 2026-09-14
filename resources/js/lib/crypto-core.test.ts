import { describe, expect, test } from 'vitest';
import {
    DecryptionError,
    decryptWithFragmentKey,
    decryptWithPassword,
    encryptContent,
    fromBase64Url,
    plaintextBytesForCiphertext,
    shareUrlFor,
    toBase64Url,
} from './crypto-core';

/**
 * The core runs in Node here with no DOM, which is the point: the MCP client
 * encrypts with this exact module and the browser decrypts with it.
 */
describe('crypto-core', () => {
    const tricky = '﻿BOM first\r\nCRLF line\n\ttab  two spaces   \n'
        + 'Zwölf Boxkämpfer 日本語 🤖 — “quotes”\n'
        + '```js\nconsole.log("x")\n```\n'
        + '| a | b |\n|---|---|\n| 1 | 2 |\n\n\n\ntrailing newlines\n\n';

    test('fragment mode round-trips byte for byte, including a BOM and CRLF', async () => {
        const encrypted = await encryptContent(tricky);

        expect(encrypted.encryption_meta.mode).toBe('fragment');
        expect(encrypted.fragmentKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(encrypted.content).not.toContain('Boxkämpfer');

        const decrypted = await decryptWithFragmentKey(
            encrypted.content,
            encrypted.encryption_meta,
            encrypted.fragmentKey!,
        );

        expect(decrypted).toBe(tricky);
    });

    test('password mode never exposes a fragment key and rejects a wrong password', async () => {
        const encrypted = await encryptContent('geheime offerte', 'correct horse');

        expect(encrypted.fragmentKey).toBeUndefined();
        expect(encrypted.encryption_meta).toMatchObject({ mode: 'password', iterations: 600_000 });
        expect(JSON.stringify(encrypted)).not.toContain('correct horse');

        await expect(
            decryptWithPassword(encrypted.content, encrypted.encryption_meta, 'correct horse'),
        ).resolves.toBe('geheime offerte');

        await expect(
            decryptWithPassword(encrypted.content, encrypted.encryption_meta, 'wrong'),
        ).rejects.toBeInstanceOf(DecryptionError);
    });

    test('a key from another paste does not decrypt', async () => {
        const a = await encryptContent('A');
        const b = await encryptContent('B');

        await expect(
            decryptWithFragmentKey(a.content, a.encryption_meta, b.fragmentKey!),
        ).rejects.toBeInstanceOf(DecryptionError);
    });

    test('plaintext size is recoverable from ciphertext length, matching the server rule', async () => {
        for (const text of ['', 'x', 'ab', 'abc', 'é', '🤖'.repeat(1000), 'a'.repeat(65_537)]) {
            const encrypted = await encryptContent(text);
            expect(plaintextBytesForCiphertext(encrypted.content)).toBe(new TextEncoder().encode(text).length);
        }
    });

    test('base64url handles large buffers', () => {
        // getRandomValues caps a single call at 65,536 bytes; any byte pattern will do.
        const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7919) & 0xff);
        expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    });

    test('share URLs keep the key in the fragment only', () => {
        expect(shareUrlFor('https://paste.example/', 'AbCdEfGhIjKlMnOp', 'KEY')).toBe(
            'https://paste.example/p/AbCdEfGhIjKlMnOp#k=KEY',
        );
        expect(shareUrlFor('https://paste.example', 'AbCdEfGhIjKlMnOp', null)).toBe(
            'https://paste.example/p/AbCdEfGhIjKlMnOp',
        );
    });
});
