<?php

use App\Http\Middleware\SharedContentHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Laravel\Sanctum\Exceptions\MissingAbilityException;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            \App\Http\Middleware\HandleInertiaRequests::class,
        ]);

        // Opt-in: only when the app really sits behind a TLS-terminating proxy
        // (e.g. a local tailnet share). Trusting forwarded headers without one
        // would let any client spoof its IP past the short-link throttle, so
        // nothing is trusted unless TRUSTED_PROXIES names the proxy. The host is
        // never taken from the proxy -- only scheme, port and client address.
        if ($trustedProxies = env('TRUSTED_PROXIES')) {
            $middleware->trustProxies(
                at: array_map('trim', explode(',', $trustedProxies)),
                headers: Request::HEADER_X_FORWARDED_FOR
                    | Request::HEADER_X_FORWARDED_PORT
                    | Request::HEADER_X_FORWARDED_PROTO,
            );
        }

        // MCP tool arguments are published byte for byte. The global input
        // normalisers would trim leading/trailing whitespace off a document
        // and turn an empty title into null before the tool ever saw it.
        $middleware->trimStrings(except: [fn (Request $request) => $request->is('mcp')]);
        $middleware->convertEmptyStringsToNull(except: [fn (Request $request) => $request->is('mcp')]);

        $middleware->alias([
            'abilities' => CheckAbilities::class,
            'shared-content' => SharedContentHeaders::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // The API speaks JSON whatever the client's Accept header says. A
        // redirect to /login for a missing token would be followed by curl or
        // fetch and look like success.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*', 'mcp', 'oauth/register') || $request->expectsJson(),
        );

        // Sanctum's MissingAbilityException is an AuthorizationException, which
        // the handler turns into an AccessDeniedHttpException before any render
        // callback runs -- so match on what it became and look underneath.
        $exceptions->render(function (AccessDeniedHttpException $e) {
            $missing = $e->getPrevious();

            if (! $missing instanceof MissingAbilityException) {
                return null;
            }

            return response()->json([
                'message' => 'This token is missing the required ability: '.implode(', ', $missing->abilities()).'.',
                'error' => 'missing_ability',
            ], 403);
        });

        // ValidatePostSize runs before routing, so this is the only place an
        // over-large API body can get a useful answer instead of an HTML page.
        $exceptions->render(function (PostTooLargeException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => 'The request body is larger than this server accepts. Nothing was stored.',
                'error' => 'payload_too_large',
                'max_content_bytes' => (int) config('pastebucket.api.max_content_bytes'),
            ], 413);
        });
    })->create();
