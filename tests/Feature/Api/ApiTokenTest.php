<?php

namespace Tests\Feature\Api;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Support\EncryptedPayloads;
use Tests\TestCase;

/**
 * Personal access tokens: created and revoked from the profile page, stored
 * hashed, limited by ability and expiry, and the only way into the API.
 */
class ApiTokenTest extends TestCase
{
    use EncryptedPayloads, RefreshDatabase;

    public function test_a_token_is_shown_once_and_stored_hashed(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/profile/tokens', [
            'name' => 'Claude Code',
            'abilities' => ['pastes:create', 'pastes:read'],
            'expires_in_days' => 30,
        ])->assertCreated();

        $plain = $response->json('token');
        [$id, $secret] = explode('|', $plain, 2);

        $record = PersonalAccessToken::findOrFail($id);
        $this->assertSame(hash('sha256', $secret), $record->token);
        $this->assertSame(['pastes:create', 'pastes:read'], $record->abilities);
        $this->assertEqualsWithDelta(now()->addDays(30)->timestamp, $record->expires_at->timestamp, 5);
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));

        // Nothing on the profile page can reproduce it.
        $this->actingAs($user)->get('/profile')
            ->assertInertia(fn ($page) => $page
                ->component('Profile')
                ->has('api_tokens', 1)
                ->where('api_tokens.0.name', 'Claude Code')
                ->missing('api_tokens.0.token'));

        $this->assertStringNotContainsString($secret, $this->actingAs($user)->get('/profile')->getContent());
    }

    public function test_token_creation_is_validated(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/profile/tokens', [
            'name' => 'x',
            'abilities' => ['pastes:delete-everything'],
            'expires_in_days' => 30,
        ])->assertStatus(422)->assertJsonValidationErrors('abilities.0');

        $this->actingAs($user)->postJson('/profile/tokens', [
            'name' => 'x',
            'abilities' => ['pastes:create'],
            'expires_in_days' => 9999,
        ])->assertStatus(422)->assertJsonValidationErrors('expires_in_days');

        $this->actingAs($user)->postJson('/profile/tokens', [
            'name' => '',
            'abilities' => [],
            'expires_in_days' => 30,
        ])->assertStatus(422)->assertJsonValidationErrors(['name', 'abilities']);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_guests_cannot_manage_tokens(): void
    {
        $this->postJson('/profile/tokens', ['name' => 'x', 'abilities' => ['pastes:create'], 'expires_in_days' => 7])
            ->assertUnauthorized();
    }

    public function test_revoking_a_token_blocks_the_next_api_call(): void
    {
        $user = User::factory()->create();
        $token = $this->tokenFor($user);
        $id = (int) explode('|', $token)[0];

        $this->publish($token)->assertCreated();

        $this->actingAs($user)->deleteJson("/profile/tokens/{$id}")->assertOk();

        $this->publish($token)->assertUnauthorized();
        $this->assertDatabaseCount('pastes', 1);
    }

    public function test_a_user_cannot_revoke_another_users_token(): void
    {
        $owner = User::factory()->create();
        $token = $this->tokenFor($owner);
        $id = (int) explode('|', $token)[0];

        $this->actingAs(User::factory()->create())->deleteJson("/profile/tokens/{$id}")->assertNotFound();

        $this->publish($token)->assertCreated();
    }

    public function test_missing_malformed_and_expired_tokens_are_unauthenticated(): void
    {
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/pastes', $this->apiPayload())
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);

        $this->publish('1|not-a-real-token')->assertUnauthorized();

        $expiring = $this->tokenFor(User::factory()->create(), expiresAt: now()->addHour());
        $this->publish($expiring)->assertCreated();

        $this->travel(61)->minutes();
        $this->publish($expiring)->assertUnauthorized();
    }

    public function test_a_token_without_the_ability_is_forbidden(): void
    {
        $user = User::factory()->create();
        $readOnly = $this->tokenFor($user, ['pastes:read']);

        $this->publish($readOnly)
            ->assertForbidden()
            ->assertJsonPath('error', 'missing_ability');

        $slug = $this->publish($this->tokenFor($user, ['pastes:create']))->json('data.slug');

        $this->api($this->tokenFor($user, ['pastes:create']))->getJson("/api/v1/pastes/{$slug}")->assertForbidden();
        $this->api($readOnly)->deleteJson("/api/v1/pastes/{$slug}")->assertForbidden();

        $this->assertDatabaseCount('pastes', 1);
    }

    public function test_a_browser_session_is_not_accepted_by_the_api(): void
    {
        $user = User::factory()->create();

        // Logged in on the website, but no token: the API must not care.
        $this->actingAs($user)
            ->postJson('/api/v1/pastes', $this->apiPayload())
            ->assertUnauthorized();

        $this->assertDatabaseCount('pastes', 0);
    }
}
