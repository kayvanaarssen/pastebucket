<?php

namespace Tests\Support;

use App\Models\User;
use Illuminate\Testing\TestResponse;

/**
 * Well-formed but fictitious envelopes. The server never decrypts, so all it
 * can check -- and all these need to satisfy -- is shape and size.
 */
trait EncryptedPayloads
{
    /** Base64url ciphertext whose plaintext would be exactly $plaintextBytes long. */
    protected function ciphertextFor(int $plaintextBytes): string
    {
        return rtrim(strtr(base64_encode(random_bytes($plaintextBytes + 16)), '+/', '-_'), '=');
    }

    /**
     * @return array<string, mixed>
     */
    protected function apiPayload(array $overrides = []): array
    {
        return array_replace([
            'title' => 'Shared document',
            'content' => $this->ciphertextFor(512),
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
        ], $overrides);
    }

    /**
     * @return array<string, mixed>
     */
    protected function passwordMeta(array $overrides = []): array
    {
        return array_replace([
            'mode' => 'password',
            'iv' => 'MTIzNDU2Nzg5MDEy',
            'salt' => 'c2FsdHNhbHRzYWx0c2FsdA',
            'iterations' => 600000,
            'wrapped_key' => str_repeat('Ab_-', 16),
            'wrap_iv' => 'MjEwOTg3NjU0MzIx',
        ], $overrides);
    }

    protected function tokenFor(User $user, array $abilities = ['pastes:create', 'pastes:read', 'pastes:revoke'], ?\DateTimeInterface $expiresAt = null): string
    {
        return $user->createToken('test', $abilities, $expiresAt ?? now()->addDays(30))->plainTextToken;
    }

    /**
     * The auth manager lives as long as the test's application, and Sanctum's
     * request guard remembers the user it resolved. Forget it between calls so
     * each request authenticates from scratch, as a real one would.
     */
    protected function api(string $token): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    protected function publish(string $token, array $payload = [], ?string $idempotencyKey = null): TestResponse
    {
        $request = $this->api($token);

        if ($idempotencyKey !== null) {
            $request = $request->withHeader('Idempotency-Key', $idempotencyKey);
        }

        return $request->postJson('/api/v1/pastes', $this->apiPayload($payload));
    }
}
