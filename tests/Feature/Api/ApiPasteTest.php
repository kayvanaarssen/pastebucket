<?php

namespace Tests\Feature\Api;

use App\Models\Paste;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\EncryptedPayloads;
use Tests\TestCase;

/**
 * The integration API: what a token may publish, the defaults it gets, and the
 * guarantees a retrying client relies on.
 */
class ApiPasteTest extends TestCase
{
    use EncryptedPayloads, RefreshDatabase;

    public function test_a_publish_gets_the_integration_defaults(): void
    {
        $this->freezeSecond();
        $user = User::factory()->create();

        $response = $this->publish($this->tokenFor($user))->assertCreated();

        $data = $response->json('data');
        $paste = Paste::firstOrFail();

        $this->assertSame(16, strlen($data['slug']));
        $this->assertSame(url('/p/'.$data['slug']), $data['url']);
        $this->assertStringNotContainsString('#', $data['url']);
        $this->assertSame('markdown', $data['content_format']);
        $this->assertSame('unlisted', $data['visibility']);
        $this->assertFalse($data['burn_after_read']);
        $this->assertSame('active', $data['status']);
        $this->assertSame('fragment', $data['encryption_mode']);

        // Seven days to the second, and the moment reported is the one stored.
        $this->assertSame(now()->addHours(168)->toISOString(), $data['expires_at']);
        $this->assertSame($paste->expires_at->toISOString(), $data['expires_at']);

        $this->assertSame($user->id, $paste->user_id);
        $this->assertSame('api', $paste->created_via);
        $this->assertSame('markdown', $paste->language);
        $this->assertNull($paste->password);
    }

    public function test_the_website_defaults_are_untouched(): void
    {
        $this->post('/paste', [
            'content' => 'Y2lwaGVydGV4dA',
            'visibility' => 'unlisted',
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
        ])->assertRedirect();

        $paste = Paste::firstOrFail();

        $this->assertSame('code', $paste->content_format);
        $this->assertSame('web', $paste->created_via);
        $this->assertEqualsWithDelta(
            now()->addHours((int) config('pastebucket.default_expiry_hours'))->timestamp,
            $paste->expires_at->timestamp,
            5,
        );
    }

    public function test_a_custom_expiry_within_the_account_limit_is_honoured(): void
    {
        $this->freezeSecond();
        $token = $this->tokenFor(User::factory()->create());

        $this->publish($token, ['expires_in_hours' => 24])
            ->assertCreated()
            ->assertJsonPath('data.expires_at', now()->addDay()->toISOString());
    }

    public function test_an_expiry_beyond_the_account_limit_is_refused_explicitly(): void
    {
        config(['pastebucket.user_max_expiry_hours' => 720]);
        $token = $this->tokenFor(User::factory()->create());

        $this->publish($token, ['expires_in_hours' => 721])
            ->assertStatus(422)
            ->assertJsonPath('errors.expires_in_hours.0', 'The expiry may be at most 720 hours (30 days) for this account.');

        // Never "unlimited" by way of zero.
        $this->publish($token, ['expires_in_hours' => 0])->assertStatus(422);

        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_limits_reflect_configuration(): void
    {
        config(['pastebucket.api.max_content_bytes' => 1234, 'pastebucket.user_max_expiry_hours' => 336]);
        $token = $this->tokenFor(User::factory()->create(), ['pastes:create']);

        $this->api($token)->getJson('/api/v1/limits')
            ->assertOk()
            ->assertJsonPath('data.max_content_bytes', 1234)
            ->assertJsonPath('data.default_expiry_hours', 168)
            ->assertJsonPath('data.max_expiry_hours', 336)
            ->assertJsonPath('data.content_formats', ['code', 'markdown']);
    }

    public function test_code_format_and_password_mode_are_accepted(): void
    {
        $token = $this->tokenFor(User::factory()->create());

        $this->publish($token, [
            'content_format' => 'code',
            'language' => 'text',
            'encryption_meta' => $this->passwordMeta(),
        ])
            ->assertCreated()
            ->assertJsonPath('data.content_format', 'code')
            ->assertJsonPath('data.language', 'text')
            ->assertJsonPath('data.encryption_mode', 'password');
    }

    /**
     * @return array<string, array{0: array<string, mixed>, 1: string}>
     */
    public static function invalidEnvelopes(): array
    {
        return [
            'no envelope' => [['encryption_version' => null, 'encryption_meta' => null], 'encryption_meta'],
            'unknown version' => [['encryption_version' => 2], 'encryption_version'],
            'iv of the wrong size' => [['encryption_meta' => ['mode' => 'fragment', 'iv' => 'short']], 'encryption_meta.iv'],
            'fragment mode carrying wrap parameters' => [['encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy', 'salt' => 'c2FsdHNhbHRzYWx0c2FsdA']], 'encryption_meta.salt'],
            'password mode without a wrapped key' => [['encryption_meta' => ['mode' => 'password', 'iv' => 'MTIzNDU2Nzg5MDEy', 'salt' => 'c2FsdHNhbHRzYWx0c2FsdA', 'iterations' => 600000, 'wrap_iv' => 'MjEwOTg3NjU0MzIx']], 'encryption_meta.wrapped_key'],
            'unexpected envelope field' => [['encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy', 'key' => 'nope']], 'encryption_meta'],
            'content that is not base64url' => [['content' => 'this is plain text, not ciphertext'], 'content'],
            'unknown content format' => [['content_format' => 'html'], 'content_format'],
        ];
    }

    #[DataProvider('invalidEnvelopes')]
    public function test_an_incomplete_or_malformed_envelope_is_refused(array $overrides, string $field): void
    {
        $this->publish($this->tokenFor(User::factory()->create()), $overrides)
            ->assertStatus(422)
            ->assertJsonValidationErrors($field);

        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_secrets_are_refused_without_being_echoed(): void
    {
        $token = $this->tokenFor(User::factory()->create());

        foreach (['password', 'key', 'fragment_key', 'plaintext'] as $field) {
            $response = $this->publish($token, [$field => 'SECRET-VALUE-4711'])
                ->assertStatus(422)
                ->assertJsonValidationErrors($field);

            $this->assertStringNotContainsString('SECRET-VALUE-4711', $response->getContent());
        }

        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_oversized_content_is_refused_whole_and_never_truncated(): void
    {
        config(['pastebucket.api.max_content_bytes' => 1000]);
        $token = $this->tokenFor(User::factory()->create());

        $this->publish($token, ['content' => $this->ciphertextFor(1001)])
            ->assertStatus(413)
            ->assertJson([
                'error' => 'payload_too_large',
                'content_bytes' => 1001,
                'max_content_bytes' => 1000,
            ]);

        $this->assertDatabaseCount('pastes', 0);

        $exact = $this->ciphertextFor(1000);
        $this->publish($token, ['content' => $exact])->assertCreated();
        $this->assertSame($exact, Paste::firstOrFail()->content);
    }

    public function test_a_retry_with_the_same_key_returns_the_original_paste(): void
    {
        $this->freezeSecond();
        $token = $this->tokenFor(User::factory()->create());
        $payload = $this->apiPayload();

        $first = $this->publish($token, $payload, 'mcp-3f2a9c')->assertCreated();

        // An hour later the client finally retries a request whose response it
        // lost. The expiry must not move.
        $this->travel(1)->hours();

        $second = $this->publish($token, $payload, 'mcp-3f2a9c')
            ->assertOk()
            ->assertHeader('Idempotent-Replayed', 'true');

        $this->assertDatabaseCount('pastes', 1);
        $this->assertSame($first->json('data.slug'), $second->json('data.slug'));
        $this->assertSame($first->json('data.expires_at'), $second->json('data.expires_at'));
        $this->assertSame($first->json('data.created_at'), $second->json('data.created_at'));
    }

    public function test_reusing_a_key_for_different_content_is_a_conflict(): void
    {
        $token = $this->tokenFor(User::factory()->create());

        $this->publish($token, [], 'reused-key')->assertCreated();
        $this->publish($token, ['content' => $this->ciphertextFor(64)], 'reused-key')
            ->assertStatus(409)
            ->assertJsonPath('error', 'idempotency_key_reused');

        $this->assertDatabaseCount('pastes', 1);
    }

    public function test_idempotency_keys_are_scoped_per_user_and_must_be_well_formed(): void
    {
        $payload = $this->apiPayload();

        $this->publish($this->tokenFor(User::factory()->create()), $payload, 'same-key')->assertCreated();
        $this->publish($this->tokenFor(User::factory()->create()), $payload, 'same-key')->assertCreated();
        $this->assertDatabaseCount('pastes', 2);

        $this->publish($this->tokenFor(User::factory()->create()), $payload, 'spaces are not allowed')
            ->assertStatus(422)
            ->assertJsonValidationErrors('idempotency_key');
    }

    public function test_without_a_key_every_request_is_a_new_paste(): void
    {
        $token = $this->tokenFor(User::factory()->create());
        $payload = $this->apiPayload();

        $this->publish($token, $payload)->assertCreated();
        $this->publish($token, $payload)->assertCreated();

        $this->assertDatabaseCount('pastes', 2);
    }

    public function test_status_reports_on_the_owners_paste_only(): void
    {
        $owner = User::factory()->create();
        $slug = $this->publish($this->tokenFor($owner))->json('data.slug');

        $this->api($this->tokenFor($owner, ['pastes:read']))->getJson("/api/v1/pastes/{$slug}")
            ->assertOk()
            ->assertJsonPath('data.slug', $slug)
            ->assertJsonPath('data.status', 'active');

        // Another user's paste looks exactly like one that does not exist.
        $this->api($this->tokenFor(User::factory()->create(), ['pastes:read']))->getJson("/api/v1/pastes/{$slug}")
            ->assertNotFound()
            ->assertExactJson(['message' => 'Paste not found.']);

        $this->api($this->tokenFor($owner, ['pastes:read']))->getJson('/api/v1/pastes/doesnotexist1234')->assertNotFound();
    }

    public function test_status_reports_expiry_at_the_exact_moment(): void
    {
        $this->freezeSecond();
        $owner = User::factory()->create();
        $slug = $this->publish($this->tokenFor($owner), ['expires_in_hours' => 1])->json('data.slug');
        $read = $this->tokenFor($owner, ['pastes:read']);

        $this->travel(59)->minutes();
        $this->travel(59)->seconds();
        $this->api($read)->getJson("/api/v1/pastes/{$slug}")->assertJsonPath('data.status', 'active');

        $this->travel(1)->seconds();
        $this->api($read)->getJson("/api/v1/pastes/{$slug}")->assertJsonPath('data.status', 'expired');
    }

    public function test_revoking_wipes_the_content_and_is_repeatable(): void
    {
        $owner = User::factory()->create();
        $slug = $this->publish($this->tokenFor($owner))->json('data.slug');
        $revoke = $this->tokenFor($owner, ['pastes:revoke']);

        $this->api($revoke)->deleteJson("/api/v1/pastes/{$slug}")
            ->assertOk()
            ->assertJsonPath('data.status', 'revoked')
            ->assertJsonPath('data.encryption_mode', null);

        $paste = Paste::where('slug', $slug)->firstOrFail();
        $this->assertNotNull($paste->revoked_at);
        $this->assertSame('', $paste->content);
        $this->assertNull($paste->encryption_meta);

        $this->api($revoke)->deleteJson("/api/v1/pastes/{$slug}")->assertOk()->assertJsonPath('data.status', 'revoked');
    }

    public function test_a_user_cannot_revoke_someone_elses_paste(): void
    {
        $slug = $this->publish($this->tokenFor(User::factory()->create()))->json('data.slug');

        $this->api($this->tokenFor(User::factory()->create()))->deleteJson("/api/v1/pastes/{$slug}")->assertNotFound();

        $this->assertNull(Paste::where('slug', $slug)->firstOrFail()->revoked_at);
    }

    public function test_a_website_paste_without_an_owner_is_not_manageable(): void
    {
        $paste = Paste::create($this->apiPayload(['slug' => 'guestpaste123456', 'visibility' => 'unlisted', 'user_id' => null]));

        $this->api($this->tokenFor(User::factory()->create()))->deleteJson("/api/v1/pastes/{$paste->slug}")->assertNotFound();
    }

    public function test_publishing_is_rate_limited_per_user(): void
    {
        config(['pastebucket.api.publish_per_minute' => 2]);
        $token = $this->tokenFor(User::factory()->create());

        $this->publish($token)->assertCreated();
        $this->publish($token)->assertCreated();
        $this->publish($token)->assertStatus(429)->assertHeader('Retry-After');

        // Someone else still has their own allowance.
        $this->publish($this->tokenFor(User::factory()->create()))->assertCreated();
    }

    public function test_api_responses_are_never_cached(): void
    {
        $response = $this->publish($this->tokenFor(User::factory()->create()));

        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }
}
