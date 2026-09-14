<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

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
    }
}
