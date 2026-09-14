<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Passport\ClientRepository;
use Tests\Support\UsesTemporaryPassportKeys;
use Tests\TestCase;

/**
 * Logging in mid-way through an OAuth authorization (ChatGPT, Claude) must
 * land back on the consent screen. That screen is plain Blade, so an Inertia
 * login has to hand the browser a full visit rather than an XHR redirect.
 */
class LoginRedirectTest extends TestCase
{
    use RefreshDatabase, UsesTemporaryPassportKeys;

    private function authorizeUrl(): string
    {
        $this->useTemporaryPassportKeys();

        // Passport validates the client before it asks a guest to log in.
        $client = app(ClientRepository::class)->createAuthorizationCodeGrantClient(
            name: 'ChatGPT',
            redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
            confidential: false,
        );

        return '/oauth/authorize?'.http_build_query([
            'response_type' => 'code',
            'client_id' => $client->id,
            'redirect_uri' => 'https://chatgpt.com/connector_platform_oauth_redirect',
            'scope' => 'mcp:use',
            'state' => 'state-123',
            'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', str_repeat('v', 64), true)), '+/', '-_'), '='),
            'code_challenge_method' => 'S256',
        ]);
    }

    public function test_an_inertia_login_returns_to_the_consent_screen_with_a_full_visit(): void
    {
        $user = User::factory()->create(['password' => 'Correct-horse-9!']);
        $authorize = $this->authorizeUrl();

        // A guest opening the authorize URL is sent to the login page, which
        // remembers where they were going.
        $this->get($authorize)->assertRedirect(route('login'));

        $location = $this->withHeaders(['X-Inertia' => 'true', 'X-Requested-With' => 'XMLHttpRequest'])
            ->post('/login', ['email' => $user->email, 'password' => 'Correct-horse-9!'])
            ->assertStatus(409)
            ->headers->get('X-Inertia-Location');

        // Laravel stores the intended URL with its query parameters sorted, so
        // compare the destination rather than the exact string.
        parse_str((string) parse_url($location, PHP_URL_QUERY), $actualQuery);
        parse_str((string) parse_url($authorize, PHP_URL_QUERY), $expectedQuery);
        $this->assertSame(url('/oauth/authorize'), strtok($location, '?'));
        $this->assertEqualsCanonicalizing($expectedQuery, $actualQuery);

        $this->assertAuthenticatedAs($user);

        // And the full visit -- a normal browser request, no Inertia headers --
        // then shows the consent screen, not an error.
        $this->flushHeaders();
        $this->get($location)->assertOk()->assertSee('Connect ChatGPT?');
    }

    public function test_a_plain_login_without_a_pending_target_goes_home(): void
    {
        $user = User::factory()->create(['password' => 'Correct-horse-9!']);

        $this->post('/login', ['email' => $user->email, 'password' => 'Correct-horse-9!'])
            ->assertRedirect(route('home'));
    }
}
