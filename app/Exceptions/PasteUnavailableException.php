<?php

namespace App\Exceptions;

use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * A paste link that no longer (or never did) lead anywhere.
 *
 * Thrown from every route that serves paste content so the refusal, and the
 * page that explains it, is the same whether the link was a slug, a short
 * code or the raw view. Being an HttpException it is never logged.
 */
class PasteUnavailableException extends HttpException
{
    public const NOT_FOUND = 'not_found';

    public const EXPIRED = 'expired';

    public const REVOKED = 'revoked';

    public function __construct(
        public readonly string $reason,
        public readonly ?CarbonInterface $at = null,
    ) {
        // Expired stays a 404, as it always was; revoked is a deliberate
        // withdrawal, which is what 410 Gone is for.
        parent::__construct($reason === self::REVOKED ? 410 : 404, match ($reason) {
            self::EXPIRED => 'This paste has expired.',
            self::REVOKED => 'This paste has been revoked.',
            default => 'This paste does not exist.',
        });
    }

    public function render(Request $request): Response
    {
        if ($request->expectsJson() && ! $request->header('X-Inertia')) {
            return response()->json(['message' => $this->getMessage()], $this->getStatusCode());
        }

        return Inertia::render('PasteUnavailable', [
            'reason' => $this->reason,
            'at' => $this->at?->toISOString(),
        ])->toResponse($request)->setStatusCode($this->getStatusCode());
    }
}
