<?php

namespace Tests\Feature;

use App\Models\Paste;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Covers short links.
 *
 * A short code is the entire link -- six characters, no fragment -- which means
 * for an encrypted paste the code *is* the key: the browser wraps the content
 * key under it and the server stores only the wrapped bytes and an HMAC of the
 * code. These tests pin the three things that follow. Only an owner can mint.
 * A paste reached by its code meets exactly the gates it would by slug. And the
 * server never stores the code, nor hands the wrapped key to anyone who has not
 * already presented one.
 */
class PasteShortLinkTest extends TestCase
{
    use RefreshDatabase;

    private const CODE = 'Kmn7Qx';

    /** @return array<string, string> */
    private function envelope(): array
    {
        return [
            'salt' => 'MTIzNDU2Nzg5MDEyMzQ1Ng',
            'iterations' => 600000,
            'wrapped_key' => 'd3JhcHBlZC1rZXktYnl0ZXM',
            'wrap_iv' => 'MTIzNDU2Nzg5MDEy',
        ];
    }

    private function hash(string $code): string
    {
        return hash_hmac('sha256', $code, config('app.key'));
    }

    private function paste(array $overrides = []): Paste
    {
        return Paste::create(array_merge([
            'slug' => 'aaaaaaaaaaaaaaaa',
            'title' => 'A paste',
            'content' => 'Y2lwaGVydGV4dA',
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
            'language' => 'text',
            'visibility' => 'unlisted',
        ], $overrides));
    }

    public function test_owner_can_mint_a_short_link(): void
    {
        $user = User::factory()->create();
        $paste = $this->paste(['user_id' => $user->id]);

        $response = $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link", [
            'short_code' => self::CODE,
            'short_meta' => $this->envelope(),
        ]);

        $response->assertOk();

        // Six characters and nothing after them -- the whole point of the feature.
        $this->assertStringEndsWith('/s/'.self::CODE, $response->json('short_url'));
        $this->assertStringNotContainsString('#', $response->json('short_url'));
    }

    public function test_the_code_itself_is_never_stored(): void
    {
        $user = User::factory()->create();
        $paste = $this->paste(['user_id' => $user->id]);

        $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link", [
            'short_code' => self::CODE,
            'short_meta' => $this->envelope(),
        ])->assertOk();

        // The code unwraps the key. Storing it beside the wrapped key would put
        // both halves of the secret in the same dump.
        foreach (Paste::first()->getAttributes() as $column => $value) {
            $this->assertStringNotContainsString(
                self::CODE,
                (string) $value,
                "Column {$column} leaks the short code.",
            );
        }

        $this->assertSame($this->hash(self::CODE), Paste::first()->short_code_hash);
    }

    public function test_a_malformed_code_is_rejected(): void
    {
        $user = User::factory()->create();
        $paste = $this->paste(['user_id' => $user->id]);

        foreach (['short', 'toolongcode', 'Kmn7Q0', 'Kmn7Q!'] as $bad) {
            $this->actingAs($user)
                ->postJson("/p/{$paste->slug}/short-link", ['short_code' => $bad])
                ->assertStatus(422);
        }
    }

    public function test_a_code_taken_by_another_paste_is_refused(): void
    {
        $user = User::factory()->create();
        $this->paste(['slug' => 'bbbbbbbbbbbbbbbb', 'short_code_hash' => $this->hash(self::CODE)]);
        $mine = $this->paste(['user_id' => $user->id]);

        $this->actingAs($user)
            ->postJson("/p/{$mine->slug}/short-link", ['short_code' => self::CODE])
            ->assertStatus(409);
    }

    public function test_minting_again_replaces_the_previous_code(): void
    {
        $user = User::factory()->create();
        $paste = $this->paste(['user_id' => $user->id]);

        $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link", ['short_code' => self::CODE]);
        $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link", ['short_code' => 'Zbq4Wt']);

        $this->assertSame($this->hash('Zbq4Wt'), $paste->fresh()->short_code_hash);
        $this->get('/s/'.self::CODE)->assertNotFound();
        $this->get('/s/Zbq4Wt')->assertOk();
    }

    public function test_a_stranger_cannot_mint_a_short_code(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $paste = $this->paste(['user_id' => $owner->id]);

        $this->actingAs($stranger)
            ->postJson("/p/{$paste->slug}/short-link", ['short_code' => self::CODE])
            ->assertForbidden();

        $this->assertNull($paste->fresh()->short_code_hash);
    }

    public function test_guest_creator_can_mint_for_their_own_paste(): void
    {
        $this->post('/paste', [
            'title' => 'A paste',
            'content' => 'Y2lwaGVydGV4dA',
            'language' => 'text',
            'password' => null,
            'visibility' => 'unlisted',
            'expiry_hours' => 1,
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
        ])->assertRedirect();

        $slug = Paste::firstOrFail()->slug;

        // The creator session set by store() is what makes this the owner.
        $this->postJson("/p/{$slug}/short-link", ['short_code' => self::CODE])->assertOk();
    }

    public function test_short_code_resolves_to_the_paste(): void
    {
        $paste = $this->paste(['short_code_hash' => $this->hash(self::CODE)]);

        $this->get('/s/'.self::CODE)
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('PasteView')
                ->where('paste.slug', $paste->slug));
    }

    public function test_short_code_is_case_sensitive_and_unknown_codes_404(): void
    {
        $this->paste(['short_code_hash' => $this->hash(self::CODE)]);

        $this->get('/s/kmn7qx')->assertNotFound();
        $this->get('/s/zzzzzz')->assertNotFound();
    }

    public function test_short_code_does_not_bypass_the_private_gate(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $this->paste([
            'user_id' => $owner->id,
            'visibility' => 'private',
            'short_code_hash' => $this->hash(self::CODE),
        ]);

        $this->actingAs($stranger)->get('/s/'.self::CODE)->assertForbidden();
    }

    public function test_short_code_does_not_bypass_expiry(): void
    {
        $this->paste(['short_code_hash' => $this->hash(self::CODE), 'expires_at' => now()->subHour()]);

        $this->get('/s/'.self::CODE)->assertNotFound();
        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_the_wrapped_key_is_withheld_from_the_slug_route(): void
    {
        $paste = $this->paste([
            'short_code_hash' => $this->hash(self::CODE),
            'short_meta' => $this->envelope(),
        ]);

        // Serving the wrapping parameters here would hand anyone holding the
        // slug the material to brute-force a 2^34 code offline.
        $this->get("/p/{$paste->slug}")
            ->assertInertia(fn ($page) => $page
                ->where('paste.short_meta', null)
                ->where('paste.has_short_link', true));

        // A viewer who already presented a code has proved they hold it.
        $this->get('/s/'.self::CODE)
            ->assertInertia(fn ($page) => $page
                ->where('paste.short_meta.wrapped_key', $this->envelope()['wrapped_key']));
    }
}
