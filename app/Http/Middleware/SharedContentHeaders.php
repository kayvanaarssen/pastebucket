<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Response headers for anything that carries paste content or ciphertext.
 *
 * no-store     - a shared link can expire or be revoked at any moment; no
 *                browser, proxy or CDN may keep a copy that outlives that.
 * no-referrer  - links inside a document must not tell other sites which
 *                paste they were clicked from. (The key is in the fragment,
 *                which browsers never put in a Referer anyway.)
 * noindex      - unlisted and private pastes are not for search engines. A
 *                controller opts a public paste back in via the request
 *                attribute below.
 */
class SharedContentHeaders
{
    public const INDEXABLE = 'shared_content.indexable';

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('Cache-Control', 'no-store, max-age=0, private');
        $response->headers->set('Pragma', 'no-cache');
        $response->headers->set('Referrer-Policy', 'no-referrer');

        if ($request->attributes->get(self::INDEXABLE) !== true) {
            $response->headers->set('X-Robots-Tag', 'noindex, nofollow, noarchive');
        }

        return $response;
    }
}
