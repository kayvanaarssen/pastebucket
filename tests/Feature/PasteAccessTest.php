<?php

namespace Tests\Feature;

use App\Models\Paste;
use App\Models\PasteIdempotencyKey;
use App\Models\User;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\EncryptedPayloads;
use Tests\TestCase;

/**
 * Who can still reach a paste, through which address, and until when.
 *
 * Every route that serves content must agree: the slug page, the short link,
 * the raw view, the editor and the API. These tests walk each of them over the
 * same boundaries.
 */
class PasteAccessTest extends TestCase
{
    use EncryptedPayloads, RefreshDatabase;

    private const CODE = 'Kmn7Qx';

    private function paste(array $overrides = []): Paste
    {
        return Paste::create(array_merge([
            'slug' => 'aaaaaaaaaaaaaaaa',
            'title' => 'Offerte Fictief BV',
            'content' => $this->ciphertextFor(200),
            'content_format' => 'markdown',
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
            'language' => 'markdown',
            'visibility' => 'unlisted',
        ], $overrides));
    }

    public function test_a_paste_without_burn_after_read_opens_repeatedly(): void
    {
        $paste = $this->paste();

        foreach (range(1, 3) as $view) {
            $this->get("/p/{$paste->slug}")->assertOk()->assertInertia(fn ($page) => $page
                ->component('PasteView')
                ->where('paste.content', $paste->content)
                ->where('paste.content_format', 'markdown'));
        }

        $this->assertSame(3, $paste->fresh()->views);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function contentRoutes(): array
    {
        return [
            'slug page' => ['/p/{slug}'],
            'raw view' => ['/p/{slug}/raw'],
            'short link' => ['/s/'.self::CODE],
        ];
    }

    #[DataProvider('contentRoutes')]
    public function test_access_ends_exactly_at_the_expiry_moment(string $route): void
    {
        $this->travelTo(now()->startOfSecond());
        $expiresAt = now()->addDays(7);

        $paste = $this->paste([
            'expires_at' => $expiresAt,
            'short_code_hash' => hash_hmac('sha256', self::CODE, config('app.key')),
        ]);
        $url = str_replace('{slug}', $paste->slug, $route);

        $this->travelTo($expiresAt->copy()->subSecond());
        $this->get($url)->assertOk();

        $this->travelTo($expiresAt);
        $this->get($url)
            ->assertNotFound()
            ->assertInertia(fn ($page) => $page
                ->component('PasteUnavailable')
                ->where('reason', 'expired')
                ->where('at', $expiresAt->toISOString()));

        $this->assertDatabaseMissing('pastes', ['slug' => $paste->slug]);
    }

    public function test_the_owner_cannot_edit_or_save_at_the_expiry_moment(): void
    {
        $this->travelTo(now()->startOfSecond());
        $owner = User::factory()->create();
        $paste = $this->paste(['user_id' => $owner->id, 'expires_at' => now()->addHour()]);

        $this->travelTo($paste->expires_at);

        $this->actingAs($owner)->get("/p/{$paste->slug}/edit")->assertNotFound();
        $this->assertDatabaseCount('pastes', 0);
    }

    public function test_a_revoked_paste_is_gone_from_every_route(): void
    {
        $owner = User::factory()->create();
        $slug = $this->publish($this->tokenFor($owner))->json('data.slug');
        Paste::where('slug', $slug)->update(['short_code_hash' => hash_hmac('sha256', self::CODE, config('app.key'))]);

        $this->api($this->tokenFor($owner))->deleteJson("/api/v1/pastes/{$slug}")->assertOk();

        $this->app['auth']->forgetGuards();

        $this->get("/p/{$slug}")
            ->assertStatus(410)
            ->assertInertia(fn ($page) => $page->component('PasteUnavailable')->where('reason', 'revoked'));
        $this->get("/p/{$slug}/raw")->assertStatus(410);
        $this->get('/s/'.self::CODE)->assertNotFound();
        $this->actingAs($owner)->get("/p/{$slug}/edit")->assertStatus(410);
        $this->actingAs($owner)->put("/p/{$slug}", [
            'content' => $this->ciphertextFor(10),
            'visibility' => 'unlisted',
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
        ])->assertStatus(410);

        $this->assertSame('', Paste::where('slug', $slug)->value('content'));
    }

    public function test_an_unknown_link_explains_itself(): void
    {
        $this->get('/p/nosuchpaste12345')
            ->assertNotFound()
            ->assertInertia(fn ($page) => $page->component('PasteUnavailable')->where('reason', 'not_found'));
    }

    public function test_shared_content_is_no_store_and_noindex_unless_public(): void
    {
        $unlisted = $this->paste();
        $public = $this->paste(['slug' => 'bbbbbbbbbbbbbbbb', 'visibility' => 'public']);

        $response = $this->get("/p/{$unlisted->slug}");
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('noindex', $response->headers->get('X-Robots-Tag'));
        $response->assertHeader('Referrer-Policy', 'no-referrer');

        $response = $this->get("/p/{$public->slug}");
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertFalse($response->headers->has('X-Robots-Tag'));

        // A dead link is not cached either, or it could outlive a new paste.
        $response = $this->get('/p/nosuchpaste12345');
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('noindex', $response->headers->get('X-Robots-Tag'));
    }

    public function test_the_website_stores_and_keeps_the_content_format(): void
    {
        $owner = User::factory()->create();
        $envelope = [
            'title' => 'Fictief BV',
            'expiry_hours' => 24,
            'visibility' => 'unlisted',
            'encryption_version' => 1,
            'encryption_meta' => ['mode' => 'fragment', 'iv' => 'MTIzNDU2Nzg5MDEy'],
        ];

        $this->actingAs($owner)->post('/paste', [...$envelope, 'content' => 'Y2lwaGVydGV4dA', 'content_format' => 'markdown', 'language' => 'markdown'])
            ->assertRedirect();
        $paste = Paste::firstOrFail();
        $this->assertSame('markdown', $paste->content_format);

        // An editor that predates the field omits it; the format must survive.
        $this->actingAs($owner)->put("/p/{$paste->slug}", [...$envelope, 'content' => 'bmV3Y2lwaGVy', 'language' => 'markdown'])
            ->assertRedirect();
        $this->assertSame('markdown', $paste->fresh()->content_format);

        $this->actingAs($owner)->put("/p/{$paste->slug}", [...$envelope, 'content' => 'bmV3Y2lwaGVy', 'content_format' => 'code', 'language' => 'php'])
            ->assertRedirect();
        $this->assertSame('code', $paste->fresh()->content_format);

        $this->actingAs($owner)->post('/paste', [...$envelope, 'content' => 'Y2lwaGVydGV4dA', 'content_format' => 'html'])
            ->assertSessionHasErrors('content_format');

        $this->actingAs($owner)->get("/p/{$paste->slug}/edit")
            ->assertInertia(fn ($page) => $page->component('PasteEdit')->where('paste.content_format', 'code'));
    }

    public function test_rows_from_before_the_column_read_as_code(): void
    {
        // Inserted the way the previous release did, without the new column.
        \Illuminate\Support\Facades\DB::table('pastes')->insert([
            'slug' => 'oldrow0000000001',
            'content' => 'legacy plain text',
            'language' => 'markdown',
            'visibility' => 'unlisted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame('code', Paste::where('slug', 'oldrow0000000001')->firstOrFail()->contentFormat());

        $this->get('/p/oldrow0000000001')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('paste.content_format', 'code')
                ->where('paste.language', 'markdown')
                ->where('paste.content', 'legacy plain text'));
    }

    public function test_cleanup_removes_only_what_is_already_unreachable(): void
    {
        $this->travelTo(now()->startOfSecond());
        $user = User::factory()->create();

        $this->paste(['slug' => 'expiredexpired01', 'expires_at' => now()]);
        $this->paste(['slug' => 'stillvalid000001', 'expires_at' => now()->addSecond()]);
        $this->paste(['slug' => 'neverexpires0001', 'expires_at' => null]);
        $this->paste(['slug' => 'revokedlongago01', 'expires_at' => null, 'revoked_at' => now()->subDays(31)]);
        $this->paste(['slug' => 'revokedrecently1', 'expires_at' => now()->addDay(), 'revoked_at' => now()->subDay()]);
        PasteIdempotencyKey::create(['user_id' => $user->id, 'key' => 'old', 'request_hash' => str_repeat('a', 64), 'expires_at' => now()]);
        PasteIdempotencyKey::create(['user_id' => $user->id, 'key' => 'new', 'request_hash' => str_repeat('a', 64), 'expires_at' => now()->addDay()]);

        $this->artisan('pastes:clean')->assertSuccessful();

        $this->assertEqualsCanonicalizing(
            ['stillvalid000001', 'neverexpires0001', 'revokedrecently1'],
            Paste::pluck('slug')->all(),
        );
        $this->assertSame(['new'], PasteIdempotencyKey::pluck('key')->all());
    }

    public function test_the_scheduler_runs_cleanup_hourly(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('pastes:clean')
            ->expectsOutputToContain('sanctum:prune-expired')
            ->assertSuccessful();
    }

    public function test_browser_routes_keep_csrf_protection_and_the_api_has_none(): void
    {
        $router = app('router');
        $middlewareFor = fn (string $name) => $router->gatherRouteMiddleware(Route::getRoutes()->getByName($name));
        $hasCsrf = fn (array $middleware) => collect($middleware)->contains(
            fn ($m) => is_string($m) && is_a($m, PreventRequestForgery::class, true),
        );

        foreach (['paste.store', 'paste.update', 'paste.short-link', 'profile.tokens.store', 'profile.tokens.destroy'] as $name) {
            $this->assertTrue($hasCsrf($middlewareFor($name)), "{$name} must be CSRF-protected");
        }

        foreach (['api.v1.pastes.store', 'api.v1.pastes.revoke'] as $name) {
            $this->assertFalse($hasCsrf($middlewareFor($name)), "{$name} must not rely on CSRF");
            $this->assertNotContains(\Illuminate\Session\Middleware\StartSession::class, $middlewareFor($name));
        }

        // And the protection really fires outside the test harness's bypass.
        $middleware = new class(app(), app('encrypter')) extends \Illuminate\Foundation\Http\Middleware\ValidateCsrfToken
        {
            protected function runningUnitTests()
            {
                return false;
            }
        };

        $request = Request::create('/paste', 'POST');
        $request->setLaravelSession(app('session.store'));

        $this->expectException(TokenMismatchException::class);
        $middleware->handle($request, fn () => response('should not get here'));
    }
}
