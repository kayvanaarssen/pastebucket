<?php

namespace Tests\Feature;

use App\Models\Paste;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Covers the server half of end-to-end encryption.
 *
 * The browser holds the only content key, so these tests cannot assert anything
 * about plaintext. What they can assert -- and what actually matters -- is that
 * the server never acquires a secret it should not have, and never destroys or
 * discloses content it should not.
 */
class PasteEncryptionTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, mixed>
     */
    private function encryptedPayload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Encrypted paste',
            'content' => 'Y2lwaGVydGV4dA',
            'language' => 'text',
            'visibility' => 'unlisted',
            'burn_after_read' => false,
            'encryption_version' => 1,
            'encryption_meta' => [
                'mode' => 'fragment',
                'iv' => 'MTIzNDU2Nzg5MDEy',
            ],
        ], $overrides);
    }

    public function test_it_stores_the_encryption_envelope(): void
    {
        $this->post('/paste', $this->encryptedPayload())->assertRedirect();

        $paste = Paste::firstOrFail();

        $this->assertSame(1, $paste->encryption_version);
        $this->assertSame('fragment', $paste->encryption_meta['mode']);
        $this->assertTrue($paste->isEncrypted());
    }

    public function test_it_never_stores_a_password_for_an_encrypted_paste(): void
    {
        // A password on an encrypted paste only wraps the content key in the
        // browser. Persisting a hash of it would hand an attacker an offline
        // verifier for that key, so the column must stay null.
        $this->post('/paste', $this->encryptedPayload([
            'password' => 'correct horse battery staple',
            'encryption_meta' => [
                'mode' => 'password',
                'iv' => 'MTIzNDU2Nzg5MDEy',
                'salt' => 'c2FsdHNhbHRzYWx0c2E',
                'iterations' => 600000,
                'wrapped_key' => 'd3JhcHBlZGtleQ',
                'wrap_iv' => 'MjEwOTg3NjU0MzIx',
            ],
        ]))->assertRedirect();

        $paste = Paste::firstOrFail();

        $this->assertNull($paste->password);
        $this->assertTrue($paste->isPasswordProtected(), 'password mode comes from the envelope, not the column');
    }

    public function test_it_rejects_an_envelope_without_metadata(): void
    {
        $payload = $this->encryptedPayload();
        unset($payload['encryption_meta']);

        $this->post('/paste', $payload)->assertSessionHasErrors('encryption_meta');
    }

    public function test_it_rejects_an_unknown_encryption_version(): void
    {
        $this->post('/paste', $this->encryptedPayload(['encryption_version' => 99]))
            ->assertSessionHasErrors('encryption_version');
    }

    public function test_it_exposes_ciphertext_and_envelope_to_the_viewer(): void
    {
        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'abcdefghijklmnop',
            'content' => 'Y2lwaGVydGV4dA',
        ]));

        $this->get("/p/{$paste->slug}")
            ->assertInertia(fn ($page) => $page
                ->component('PasteView')
                ->where('paste.is_encrypted', true)
                ->where('paste.content', 'Y2lwaGVydGV4dA')
                ->where('paste.encryption_meta.mode', 'fragment'));
    }

    public function test_an_encrypted_paste_skips_the_server_side_password_gate(): void
    {
        // The ciphertext is the gate. Rendering the password page here would be
        // security theatre: the server has nothing to check.
        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'passwordmode1234',
            'encryption_meta' => [
                'mode' => 'password',
                'iv' => 'MTIzNDU2Nzg5MDEy',
                'salt' => 'c2FsdHNhbHRzYWx0c2E',
                'wrapped_key' => 'd3JhcHBlZGtleQ',
                'wrap_iv' => 'MjEwOTg3NjU0MzIx',
            ],
        ]));

        $this->get("/p/{$paste->slug}")
            ->assertInertia(fn ($page) => $page->component('PasteView'));
    }

    public function test_the_verify_route_is_gone_for_encrypted_pastes(): void
    {
        $paste = Paste::create($this->encryptedPayload(['slug' => 'verifygone12345a']));

        $this->post("/p/{$paste->slug}/verify", ['password' => 'anything'])->assertNotFound();
    }

    public function test_an_encrypted_burn_paste_survives_a_render(): void
    {
        // The server cannot tell whether the viewer held a usable key, so it must
        // not destroy content that may never have been read.
        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'burnpaste1234567',
            'burn_after_read' => true,
        ]));

        $this->get("/p/{$paste->slug}")->assertOk();

        $this->assertDatabaseHas('pastes', ['slug' => 'burnpaste1234567']);
    }

    public function test_it_burns_on_acknowledgement(): void
    {
        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'burnack123456789',
            'burn_after_read' => true,
        ]));

        $this->post("/p/{$paste->slug}/burn")->assertNoContent();

        $this->assertDatabaseMissing('pastes', ['slug' => 'burnack123456789']);
    }

    public function test_the_burn_endpoint_cannot_delete_a_non_burn_paste(): void
    {
        // Otherwise the ACK becomes an unauthenticated delete primitive for any
        // paste whose slug an attacker can guess or scrape.
        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'notaburnpaste123',
            'burn_after_read' => false,
        ]));

        $this->post("/p/{$paste->slug}/burn")->assertForbidden();

        $this->assertDatabaseHas('pastes', ['slug' => 'notaburnpaste123']);
    }

    public function test_the_burn_endpoint_does_not_leak_private_pastes(): void
    {
        $owner = User::factory()->create();

        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'privateburn12345',
            'user_id' => $owner->id,
            'visibility' => 'private',
            'burn_after_read' => true,
        ]));

        $this->post("/p/{$paste->slug}/burn")->assertForbidden();

        $this->assertDatabaseHas('pastes', ['slug' => 'privateburn12345']);
    }

    public function test_the_owner_does_not_burn_their_own_paste(): void
    {
        $owner = User::factory()->create();

        $paste = Paste::create($this->encryptedPayload([
            'slug' => 'ownerburn1234567',
            'user_id' => $owner->id,
            'burn_after_read' => true,
        ]));

        $this->actingAs($owner)->post("/p/{$paste->slug}/burn")->assertNoContent();

        $this->assertDatabaseHas('pastes', ['slug' => 'ownerburn1234567']);
    }

    public function test_raw_renders_a_decrypting_page_instead_of_ciphertext(): void
    {
        $paste = Paste::create($this->encryptedPayload(['slug' => 'rawencrypted1234']));

        $this->get("/p/{$paste->slug}/raw")
            ->assertInertia(fn ($page) => $page->component('PasteRaw'));
    }

    public function test_legacy_pastes_remain_readable(): void
    {
        // Rows predating E2E have no version and stay plaintext. The server
        // cannot upgrade them without holding a key, which is the whole point.
        $paste = Paste::create([
            'slug' => 'legacypaste12345',
            'title' => 'Legacy',
            'content' => 'plain text content',
            'visibility' => 'unlisted',
        ]);

        $this->assertFalse($paste->isEncrypted());

        $this->get("/p/{$paste->slug}/raw")
            ->assertOk()
            ->assertSee('plain text content');
    }

    public function test_legacy_password_pastes_keep_the_server_side_gate(): void
    {
        $paste = Paste::create([
            'slug' => 'legacypw12345678',
            'title' => 'Legacy protected',
            'content' => 'secret legacy content',
            'password' => bcrypt('hunter2'),
            'visibility' => 'unlisted',
        ]);

        $this->get("/p/{$paste->slug}")
            ->assertInertia(fn ($page) => $page->component('PastePassword'));

        $this->post("/p/{$paste->slug}/verify", ['password' => 'hunter2'])
            ->assertRedirect("/p/{$paste->slug}");
    }

    public function test_a_legacy_burn_paste_still_burns_on_render(): void
    {
        $paste = Paste::create([
            'slug' => 'legacyburn123456',
            'content' => 'read once',
            'visibility' => 'unlisted',
            'burn_after_read' => true,
        ]);

        $this->get("/p/{$paste->slug}")->assertOk();

        $this->assertDatabaseMissing('pastes', ['slug' => 'legacyburn123456']);
    }
}
