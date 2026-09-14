<?php

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\PastebucketServer;
use App\Mcp\Tools\GetOutputStatusTool;
use App\Mcp\Tools\PublishOutputTool;
use App\Mcp\Tools\RevokeOutputTool;
use App\Models\OAuthUser;
use App\Models\Paste;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;
use Laravel\Passport\Token;
use Tests\Support\DecryptsWithCryptoCore;
use Tests\TestCase;

/**
 * The hosted MCP endpoint for OAuth clients such as ChatGPT: discovery, client
 * registration, authentication, the three tools, and disconnecting.
 */
class RemoteMcpTest extends TestCase
{
    use DecryptsWithCryptoCore, RefreshDatabase;

    private const DOCUMENT = "# Advies Fictief BV\n\nBeste Jan, het **volledige advies**:\n\n| Fase | Kosten |\n| --- | ---: |\n| Migratie | 4.750 |\n\n```bash\n\tindented  \n```\n  trailing spaces stay  \n";

    private function oauthUser(): OAuthUser
    {
        return OAuthUser::findOrFail(User::factory()->create()->id);
    }

    /** @return array<string, mixed> */
    private function publish(OAuthUser $user, array $arguments): array
    {
        $captured = [];

        PastebucketServer::actingAs($user, 'api')
            ->tool(PublishOutputTool::class, $arguments)
            ->assertOk()
            ->assertHasNoErrors()
            ->assertStructuredContent(function ($json) use (&$captured) {
                $captured = $json->toArray();

                // Values are asserted by the calling test; here we only read them.
                $json->etc();
            });

        return $captured;
    }

    public function test_discovery_metadata_points_at_this_server(): void
    {
        $this->getJson('/.well-known/oauth-protected-resource/mcp')
            ->assertOk()
            ->assertJsonPath('resource', url('/mcp'))
            ->assertJsonPath('authorization_servers.0', url('/'));

        $this->getJson('/.well-known/oauth-authorization-server')
            ->assertOk()
            ->assertJsonPath('registration_endpoint', url('/oauth/register'))
            ->assertJsonPath('code_challenge_methods_supported', ['S256']);
    }

    public function test_only_allowed_redirect_domains_can_register_a_client(): void
    {
        $this->postJson('/oauth/register', [
            'client_name' => 'ChatGPT',
            'redirect_uris' => ['https://chatgpt.com/connector_platform_oauth_redirect'],
        ])->assertCreated()->assertJsonPath('token_endpoint_auth_method', 'none');

        $this->postJson('/oauth/register', [
            'client_name' => 'ChatGPT',
            'redirect_uris' => ['https://chatgpt.com.evil.example/callback'],
        ])->assertStatus(400)->assertJsonPath('error', 'invalid_redirect_uri');

        $this->postJson('/oauth/register', [
            'client_name' => 'ChatGPT',
            'redirect_uris' => ['https://evil.example/callback'],
        ])->assertStatus(400)->assertJsonPath('error', 'invalid_redirect_uri');
    }

    public function test_the_endpoint_requires_an_oauth_token_and_ignores_sessions_and_sanctum(): void
    {
        $user = User::factory()->create();
        $body = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'];

        $this->postJson('/mcp', $body)
            ->assertUnauthorized()
            ->assertHeader('WWW-Authenticate');

        $this->actingAs($user)->postJson('/mcp', $body)->assertUnauthorized();

        $this->app['auth']->forgetGuards();
        $sanctum = $user->createToken('api', ['pastes:create'])->plainTextToken;
        $this->withToken($sanctum)->postJson('/mcp', $body)->assertUnauthorized();
    }

    public function test_an_authenticated_client_lists_the_tools_over_http(): void
    {
        Passport::actingAs($this->oauthUser(), ['mcp:use'], 'api');

        $response = $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'], [
            'Accept' => 'application/json, text/event-stream',
        ])->assertOk();

        $this->assertEqualsCanonicalizing(
            ['publish_output', 'get_output_status', 'revoke_output'],
            array_column($response->json('result.tools'), 'name'),
        );
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    public function test_a_revoked_oauth_token_is_refused(): void
    {
        $this->useTemporaryPassportKeys();
        $user = $this->oauthUser();
        app(ClientRepository::class)->createPersonalAccessGrantClient('Test personal access', 'oauth_users');

        $token = $user->createToken('ChatGPT', ['mcp:use']);
        $body = ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'];

        $this->withToken($token->accessToken)->postJson('/mcp', $body)->assertOk();

        Token::findOrFail($token->token->id)->revoke();
        $this->app['auth']->forgetGuards();

        $this->withToken($token->accessToken)->postJson('/mcp', $body)->assertUnauthorized();
    }

    public function test_publishing_stores_only_ciphertext_and_returns_a_working_link(): void
    {
        $this->travelTo(now()->startOfSecond());
        $user = $this->oauthUser();

        $result = $this->publish($user, ['title' => 'Shared document', 'markdown' => self::DOCUMENT]);

        $paste = Paste::where('slug', $result['slug'])->firstOrFail();

        $this->assertSame($user->id, $paste->user_id);
        $this->assertSame(['markdown', 'mcp', 'unlisted', false], [$paste->content_format, $paste->created_via, $paste->visibility, $paste->burn_after_read]);
        $this->assertSame(now()->addDays(7)->toISOString(), $result['expires_at']);
        $this->assertStringNotContainsString('Fictief', $paste->content);
        $this->assertNull($paste->password);

        [$url, $key] = explode('#k=', $result['share_url']);
        $this->assertSame(url('/p/'.$paste->slug), $url);
        $this->assertStringNotContainsString($key, json_encode($paste->getAttributes()));

        // Opened exactly the way a customer's browser opens it.
        $this->assertSame(self::DOCUMENT, $this->decryptWithCryptoCore($paste->content, $paste->encryption_meta, $key));

        $this->asAnonymousWebVisitor();
        $this->get('/p/'.$paste->slug)->assertOk()->assertInertia(fn ($page) => $page
            ->component('PasteView')
            ->where('paste.content_format', 'markdown'));
    }

    public function test_password_mode_puts_no_key_in_the_link(): void
    {
        $result = $this->publish($this->oauthUser(), ['markdown' => self::DOCUMENT, 'password' => 'correct horse battery']);

        $this->assertStringNotContainsString('#', $result['share_url']);
        $this->assertTrue($result['password_protected']);

        $paste = Paste::where('slug', $result['slug'])->firstOrFail();
        $this->assertSame('password', $paste->encryption_meta['mode']);
        $this->assertSame(self::DOCUMENT, $this->decryptWithCryptoCore($paste->content, $paste->encryption_meta, null, 'correct horse battery'));
    }

    public function test_limits_are_enforced_without_truncation(): void
    {
        config(['pastebucket.user_max_expiry_hours' => 720, 'pastebucket.api.max_content_bytes' => 100]);
        $user = $this->oauthUser();

        PastebucketServer::actingAs($user, 'api')
            ->tool(PublishOutputTool::class, ['markdown' => 'x', 'expires_in_days' => 31])
            ->assertHasErrors(['The expiry may be at most 30 days for this account.']);

        PastebucketServer::actingAs($user, 'api')
            ->tool(PublishOutputTool::class, ['markdown' => str_repeat('a', 101)])
            ->assertHasErrors(['Content is 101 bytes; the maximum is 100 bytes. Nothing was published or truncated.']);

        PastebucketServer::actingAs($user, 'api')
            ->tool(PublishOutputTool::class, ['markdown' => 'short', 'password' => 'short'])
            ->assertHasErrors();

        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_status_and_revoke_only_reach_the_users_own_pastes(): void
    {
        $owner = $this->oauthUser();
        $stranger = $this->oauthUser();
        $slug = $this->publish($owner, ['markdown' => self::DOCUMENT])['slug'];

        PastebucketServer::actingAs($stranger, 'api')
            ->tool(GetOutputStatusTool::class, ['slug' => $slug])
            ->assertHasErrors();

        PastebucketServer::actingAs($stranger, 'api')
            ->tool(RevokeOutputTool::class, ['slug' => $slug])
            ->assertHasErrors();

        $this->assertNull(Paste::where('slug', $slug)->value('revoked_at'));

        PastebucketServer::actingAs($owner, 'api')
            ->tool(GetOutputStatusTool::class, ['slug' => url("/p/{$slug}#k=ignored")])
            ->assertOk()
            ->assertSee('Status: active');

        PastebucketServer::actingAs($owner, 'api')
            ->tool(RevokeOutputTool::class, ['slug' => $slug])
            ->assertOk()
            ->assertSee('The link no longer works');

        $this->assertSame('', Paste::where('slug', $slug)->value('content'));

        $this->asAnonymousWebVisitor();
        $this->get("/p/{$slug}")->assertStatus(410);
    }

    public function test_disconnecting_an_app_revokes_its_tokens(): void
    {
        $this->useTemporaryPassportKeys();
        $user = $this->oauthUser();
        $client = app(ClientRepository::class)->createPersonalAccessGrantClient('ChatGPT', 'oauth_users');
        $token = $user->createToken('ChatGPT', ['mcp:use']);

        $webUser = User::findOrFail($user->id);

        $this->actingAs($webUser)->get('/profile')
            ->assertInertia(fn ($page) => $page->has('connected_apps', 1)->where('connected_apps.0.name', 'ChatGPT'));

        $this->actingAs($webUser)->deleteJson('/profile/connected-apps/'.$client->id)->assertOk();

        $this->assertTrue(Token::findOrFail($token->token->id)->revoked);

        $this->actingAs(User::factory()->create())->deleteJson('/profile/connected-apps/'.$client->id)->assertNotFound();
    }

    public function test_publishing_leaves_no_plaintext_keys_or_passwords_in_logs(): void
    {
        $logged = [];
        app('events')->listen(MessageLogged::class, function (MessageLogged $event) use (&$logged) {
            $logged[] = $event->message.' '.print_r($event->context, true);
        });

        config(['pastebucket.api.max_content_bytes' => 10]);
        $user = $this->oauthUser();

        // Refused (too large), and a failure deep in storage.
        PastebucketServer::actingAs($user, 'api')->tool(PublishOutputTool::class, [
            'markdown' => 'PLAINTEXT-Geheime offerte Fictief BV',
            'password' => 'PASSWORD-correct-horse',
        ])->assertHasErrors();

        config(['pastebucket.api.max_content_bytes' => 5_000_000]);
        $this->mock(\App\Services\PasteService::class, function ($mock) {
            $mock->shouldReceive('maxExpiryHoursFor')->andReturn(8760);
            $mock->shouldReceive('create')->andThrow(new \RuntimeException('Database went away'));
        });

        PastebucketServer::actingAs($user, 'api')->tool(PublishOutputTool::class, [
            'markdown' => 'PLAINTEXT-Geheime offerte Fictief BV',
            'password' => 'PASSWORD-correct-horse',
        ])->assertHasErrors();

        foreach ($logged as $entry) {
            $this->assertStringNotContainsString('PLAINTEXT-Geheime', $entry);
            $this->assertStringNotContainsString('PASSWORD-correct-horse', $entry);
        }
    }

    /**
     * Tool calls made with actingAs(..., 'api') leave that guard as the default
     * on the application the test keeps between requests. A real web request
     * never inherits it; reset so the customer view is exercised as a stranger.
     */
    private function asAnonymousWebVisitor(): void
    {
        $this->app['auth']->forgetGuards();
        $this->app['auth']->shouldUse('web');
    }

    /**
     * Personal-access tokens are real signed JWTs. Sign them with throwaway
     * keys so the test never touches (or depends on) the app's own keys.
     */
    private function useTemporaryPassportKeys(): void
    {
        $dir = sys_get_temp_dir().'/pastebucket-passport-'.getmypid();

        if (! is_file("{$dir}/oauth-private.key")) {
            @mkdir($dir, 0700, true);
            $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            openssl_pkey_export($key, $private);
            file_put_contents("{$dir}/oauth-private.key", $private);
            file_put_contents("{$dir}/oauth-public.key", openssl_pkey_get_details($key)['key']);
        }

        // league/oauth2-server refuses group- or world-writable key files.
        chmod("{$dir}/oauth-private.key", 0600);
        chmod("{$dir}/oauth-public.key", 0600);

        Passport::loadKeysFrom($dir);
    }
}
