<?php

namespace Tests\Feature\Mcp;

use App\Support\EncryptionEnvelope;
use App\Support\ServerSideEncryption;
use Tests\Support\DecryptsWithCryptoCore;
use Tests\TestCase;

/**
 * The PHP port must be indistinguishable from the browser implementation:
 * whatever it encrypts, the website decrypts through its normal code path.
 */
class ServerSideEncryptionInteropTest extends TestCase
{
    use DecryptsWithCryptoCore;

    private const TRICKY = "\u{FEFF}BOM first\r\nCRLF line\n\ttab  two spaces   \n"
        ."Zwölf Boxkämpfer 日本語 🤖 — “quotes”\n```js\nconsole.log('x')\n```\n| a | b |\n|---|---|\n\n\n";

    public function test_fragment_mode_decrypts_in_the_browser_core_byte_for_byte(): void
    {
        $encrypted = ServerSideEncryption::encrypt(self::TRICKY);

        $this->assertSame('fragment', $encrypted['encryption_meta']['mode']);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $encrypted['fragment_key']);
        $this->assertStringNotContainsString('Boxkämpfer', $encrypted['content']);
        $this->assertSame(strlen(self::TRICKY), EncryptionEnvelope::plaintextBytes($encrypted['content']));

        $this->assertSame(self::TRICKY, $this->decryptWithCryptoCore(
            $encrypted['content'],
            $encrypted['encryption_meta'],
            $encrypted['fragment_key'],
        ));
    }

    public function test_password_mode_decrypts_in_the_browser_core(): void
    {
        $encrypted = ServerSideEncryption::encrypt(self::TRICKY, 'correct horse battery');

        $this->assertNull($encrypted['fragment_key']);
        $this->assertSame(600000, $encrypted['encryption_meta']['iterations']);
        $this->assertStringNotContainsString('correct horse', json_encode($encrypted));

        $this->assertSame(self::TRICKY, $this->decryptWithCryptoCore(
            $encrypted['content'],
            $encrypted['encryption_meta'],
            null,
            'correct horse battery',
        ));
    }

    public function test_the_envelope_passes_the_strict_api_validation(): void
    {
        foreach ([null, 'a strong password'] as $password) {
            $encrypted = ServerSideEncryption::encrypt('x', $password);

            $validator = validator($encrypted, EncryptionEnvelope::strictRules());

            $this->assertFalse($validator->fails(), json_encode($validator->errors()->all()));
        }
    }

    public function test_large_content_round_trips(): void
    {
        $large = str_repeat("Regel met tekst en 🤖 emoji\r\n", 80_000);

        $encrypted = ServerSideEncryption::encrypt($large);

        $this->assertSame($large, $this->decryptWithCryptoCore(
            $encrypted['content'],
            $encrypted['encryption_meta'],
            $encrypted['fragment_key'],
        ));
    }
}
