<?php

namespace Tests\Feature;

use App\Models\Paste;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Covers the short-link alias.
 *
 * A short code is a second, much shorter address for a paste. These tests pin
 * the two things that follow from that: only an owner can mint one, and a paste
 * reached by its code is subject to exactly the same gates as one reached by
 * its slug. Nothing here touches encryption -- the content key lives in the URL
 * fragment, which no request ever carries.
 */
class PasteShortLinkTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_owner_can_mint_a_short_code(): void
    {
        $user = User::factory()->create();
        $paste = $this->paste(['user_id' => $user->id]);

        $response = $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link");

        $response->assertOk()->assertJsonStructure(['short_code', 'short_url']);

        $code = $response->json('short_code');
        $this->assertSame(6, strlen($code));
        $this->assertStringEndsWith("/s/{$code}", $response->json('short_url'));
    }

    public function test_short_code_avoids_ambiguous_characters(): void
    {
        $user = User::factory()->create();

        // Enough draws to make a missed exclusion overwhelmingly likely to show.
        for ($i = 0; $i < 40; $i++) {
            $paste = $this->paste(['slug' => str_pad((string) $i, 16, 'x'), 'user_id' => $user->id]);
            $code = $this->actingAs($user)
                ->postJson("/p/{$paste->slug}/short-link")
                ->json('short_code');

            $this->assertSame(
                0,
                preg_match('/[01flhioILO]/', $code),
                "Short code {$code} contains an ambiguous character.",
            );
        }
    }

    public function test_minting_twice_returns_the_same_code(): void
    {
        $user = User::factory()->create();
        $paste = $this->paste(['user_id' => $user->id]);

        $first = $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link")->json('short_code');
        $second = $this->actingAs($user)->postJson("/p/{$paste->slug}/short-link")->json('short_code');

        $this->assertSame($first, $second);
    }

    public function test_a_stranger_cannot_mint_a_short_code(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $paste = $this->paste(['user_id' => $owner->id]);

        $this->actingAs($stranger)
            ->postJson("/p/{$paste->slug}/short-link")
            ->assertForbidden();

        $this->assertNull($paste->fresh()->short_code);
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
        $this->postJson("/p/{$slug}/short-link")->assertOk();
    }

    public function test_short_code_resolves_to_the_paste(): void
    {
        $paste = $this->paste(['short_code' => 'Kmn7Qx']);

        $this->get('/s/Kmn7Qx')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('PasteView')
                ->where('paste.slug', $paste->slug));
    }

    public function test_short_code_is_case_sensitive_and_unknown_codes_404(): void
    {
        $this->paste(['short_code' => 'Kmn7Qx']);

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
            'short_code' => 'Kmn7Qx',
        ]);

        $this->actingAs($stranger)->get('/s/Kmn7Qx')->assertForbidden();
    }

    public function test_short_code_does_not_bypass_expiry(): void
    {
        $this->paste(['short_code' => 'Kmn7Qx', 'expires_at' => now()->subHour()]);

        $this->get('/s/Kmn7Qx')->assertNotFound();
        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_short_url_is_exposed_to_the_view_without_a_fragment(): void
    {
        $paste = $this->paste(['short_code' => 'Kmn7Qx']);

        $this->get("/p/{$paste->slug}")
            ->assertInertia(fn ($page) => $page
                ->where('paste.short_url', url('/s/Kmn7Qx')));

        // The content key belongs to the browser. Nothing the server emits may
        // carry it, and a fragment is the only shape it could take.
        $this->assertStringNotContainsString('#', url('/s/Kmn7Qx'));
    }
}
