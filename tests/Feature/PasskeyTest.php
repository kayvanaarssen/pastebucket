<?php

namespace Tests\Feature;

use App\Models\Passkey;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PasskeyTest extends TestCase
{
    use RefreshDatabase;

    private const APP_URL = 'https://pastebucket.test';

    private const RP_ID = 'pastebucket.test';

    protected function setUp(): void
    {
        parent::setUp();

        config(['app.url' => self::APP_URL]);
    }

    private function base64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function clientDataJSON(string $type, string $rawChallenge, ?string $origin = null): string
    {
        return $this->base64url((string) json_encode([
            'type' => $type,
            'challenge' => $this->base64url($rawChallenge),
            'origin' => $origin ?? self::APP_URL,
        ]));
    }

    /**
     * authenticatorData = 32-byte rpIdHash + 1 flag byte + 4-byte counter.
     * Flag bits: 0x01 User Present, 0x04 User Verified.
     */
    private function authenticatorData(int $flags = 0x05, ?string $rpId = null, int $counter = 5): string
    {
        return hash('sha256', $rpId ?? self::RP_ID, true)
            .chr($flags)
            .pack('N', $counter);
    }

    private function assertion(string $authData, string $clientDataJSON): array
    {
        return [
            'id' => 'test-credential-id',
            'response' => [
                'clientDataJSON' => $clientDataJSON,
                'authenticatorData' => $this->base64url($authData),
                'signature' => $this->base64url('not-a-real-signature'),
            ],
        ];
    }

    private function passkeyFor(User $user): Passkey
    {
        return $user->passkeys()->create([
            'name' => 'Test key',
            'credential_id' => 'test-credential-id',
            'public_key' => (string) json_encode(['public_key_pem' => null, 'algorithm' => -7]),
            'counter' => 1,
        ]);
    }

    // --- Registration: failures must be JSON, never a followed redirect ---

    public function test_registration_without_a_challenge_fails_with_json_422(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/passkey/register', [
            'name' => 'My key',
            'credential' => [
                'id' => 'abc',
                'rawId' => 'abc',
                'type' => 'public-key',
                'response' => [
                    'clientDataJSON' => $this->clientDataJSON('webauthn.create', random_bytes(32)),
                    'attestationObject' => $this->base64url('irrelevant'),
                ],
            ],
        ]);

        // A 302 here is the bug this guards: fetch() follows it to a 200 and
        // the UI reports a failed registration as success.
        $response->assertStatus(422)->assertJson(['error' => 'Challenge expired. Please try again.']);
    }

    public function test_registration_rejects_a_mismatched_origin(): void
    {
        $user = User::factory()->create();
        $challenge = random_bytes(32);

        $response = $this->actingAs($user)
            ->withSession(['passkey_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/register', [
                'name' => 'My key',
                'credential' => [
                    'id' => 'abc',
                    'rawId' => 'abc',
                    'type' => 'public-key',
                    'response' => [
                        'clientDataJSON' => $this->clientDataJSON('webauthn.create', $challenge, 'https://evil.example'),
                        'attestationObject' => $this->base64url('irrelevant'),
                    ],
                ],
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'Origin verification failed.']);
    }

    public function test_registration_rejects_a_wrong_ceremony_type(): void
    {
        $user = User::factory()->create();
        $challenge = random_bytes(32);

        $response = $this->actingAs($user)
            ->withSession(['passkey_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/register', [
                'name' => 'My key',
                'credential' => [
                    'id' => 'abc',
                    'rawId' => 'abc',
                    'type' => 'public-key',
                    'response' => [
                        'clientDataJSON' => $this->clientDataJSON('webauthn.get', $challenge),
                        'attestationObject' => $this->base64url('irrelevant'),
                    ],
                ],
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'Invalid ceremony type.']);
    }

    public function test_registration_validation_failure_returns_json_not_a_redirect(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/passkey/register', ['name' => ''])
            ->assertStatus(422);
    }

    // --- Authentication: the ceremony checks that were missing ---

    public function test_authentication_rejects_a_registration_ceremony_type(): void
    {
        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    $this->authenticatorData(),
                    $this->clientDataJSON('webauthn.create', $challenge),
                ),
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'Invalid ceremony type.']);
        $this->assertGuest();
    }

    public function test_authentication_rejects_a_mismatched_rp_id_hash(): void
    {
        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    $this->authenticatorData(rpId: 'evil.example'),
                    $this->clientDataJSON('webauthn.get', $challenge),
                ),
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'RP ID verification failed.']);
        $this->assertGuest();
    }

    public function test_authentication_requires_the_user_verified_flag(): void
    {
        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        // User Present only: this is what an authenticator returns when it did
        // not perform biometric or PIN verification.
        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    $this->authenticatorData(flags: 0x01),
                    $this->clientDataJSON('webauthn.get', $challenge),
                ),
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'User verification required.']);
        $this->assertGuest();
    }

    public function test_authentication_requires_the_user_present_flag(): void
    {
        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    $this->authenticatorData(flags: 0x04),
                    $this->clientDataJSON('webauthn.get', $challenge),
                ),
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'User presence required.']);
        $this->assertGuest();
    }

    public function test_authentication_rejects_malformed_authenticator_data(): void
    {
        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    'too-short',
                    $this->clientDataJSON('webauthn.get', $challenge),
                ),
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'Malformed authenticator data.']);
        $this->assertGuest();
    }

    public function test_authentication_rejects_a_mismatched_origin(): void
    {
        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    $this->authenticatorData(),
                    $this->clientDataJSON('webauthn.get', $challenge, 'https://evil.example'),
                ),
            ]);

        $response->assertStatus(422)->assertJson(['error' => 'Origin verification failed.']);
        $this->assertGuest();
    }

    public function test_origin_comparison_tolerates_a_trailing_slash_in_app_url(): void
    {
        // A browser origin never carries a trailing slash, so a raw string
        // comparison against APP_URL would break every passkey ceremony here.
        config(['app.url' => self::APP_URL.'/']);

        $challenge = random_bytes(32);
        $this->passkeyFor(User::factory()->create());

        $response = $this->withSession(['passkey_auth_challenge' => base64_encode($challenge)])
            ->postJson('/passkey/authenticate', [
                'credential' => $this->assertion(
                    $this->authenticatorData(),
                    $this->clientDataJSON('webauthn.get', $challenge),
                ),
            ]);

        // Gets past the origin check and fails later, on the signature.
        $response->assertStatus(422)->assertJson(['error' => 'Signature verification failed.']);
    }

    // --- Revocation ---

    public function test_deleting_a_passkey_returns_json(): void
    {
        $user = User::factory()->create();
        $passkey = $this->passkeyFor($user);

        $this->actingAs($user)
            ->deleteJson("/passkey/{$passkey->id}")
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertDatabaseMissing('passkeys', ['id' => $passkey->id]);
    }

    public function test_a_user_cannot_delete_another_users_passkey(): void
    {
        $owner = User::factory()->create();
        $passkey = $this->passkeyFor($owner);

        $this->actingAs(User::factory()->create())
            ->deleteJson("/passkey/{$passkey->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('passkeys', ['id' => $passkey->id]);
    }
}
