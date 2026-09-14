<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Laravel\Passport\Passport;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Password::defaults(function () {
            return Password::min(10)
                ->mixedCase()
                ->numbers()
                ->symbols();
        });

        // Keyed on the token's user (these run after auth:sanctum), so one
        // noisy integration cannot exhaust another user's allowance.
        RateLimiter::for('pastebucket-api', fn (Request $request) => Limit::perMinute(
            (int) config('pastebucket.api.requests_per_minute'),
        )->by('api:'.($request->user()?->id ?? $request->ip())));

        RateLimiter::for('pastebucket-api-publish', fn (Request $request) => Limit::perMinute(
            (int) config('pastebucket.api.publish_per_minute'),
        )->by('api-publish:'.($request->user()?->id ?? $request->ip())));

        // Remote MCP (ChatGPT). Registration is unauthenticated by design
        // (RFC 7591), so it is held to a tight per-IP limit.
        RateLimiter::for('pastebucket-mcp', fn (Request $request) => Limit::perMinute(
            (int) config('pastebucket.api.requests_per_minute'),
        )->by('mcp:'.($request->user()?->id ?? $request->ip())));

        RateLimiter::for('pastebucket-oauth-register', fn (Request $request) => Limit::perMinute(10)
            ->by('oauth-register:'.$request->ip()));

        Passport::authorizationView(fn (array $parameters) => view('mcp.authorize', $parameters));

        // Short-lived access tokens; the client renews with its refresh token,
        // and disconnecting on the profile page revokes both.
        Passport::tokensExpireIn(now()->addHour());
        Passport::refreshTokensExpireIn(now()->addDays(30));
    }
}
