<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

class ApiTokenController extends Controller
{
    /**
     * Every ability a token can hold. Nothing here grants access to other
     * users' pastes; ownership is checked separately on every call.
     */
    public const ABILITIES = [
        'pastes:create' => 'Publish encrypted pastes',
        'pastes:read' => 'Read the status and expiry of your own pastes',
        'pastes:revoke' => 'Revoke your own pastes',
    ];

    public const EXPIRY_DAYS = [7, 30, 90, 180, 365];

    /**
     * The token list for the profile page. The token itself is stored only as
     * a SHA-256 hash and can never be shown again, so it is not in here.
     *
     * @return list<array<string, mixed>>
     */
    public static function tokensFor(Request $request): array
    {
        return $request->user()->tokens()
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (PersonalAccessToken $token) => [
                'id' => $token->id,
                'name' => $token->name,
                'abilities' => $token->abilities,
                'last_used_at' => $token->last_used_at?->toISOString(),
                'expires_at' => $token->expires_at?->toISOString(),
                'created_at' => $token->created_at?->toISOString(),
                'is_expired' => $token->expires_at !== null && $token->expires_at->isPast(),
            ])
            ->all();
    }

    /**
     * Create a token and return it exactly once.
     *
     * Answered as JSON to a fetch call rather than flashed through the session,
     * so the plain token never lands in the sessions table on its way to the
     * page.
     */
    public function store(Request $request): JsonResponse
    {
        $maxDays = (int) config('pastebucket.api.token_max_lifetime_days');

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'abilities' => ['required', 'array', 'min:1'],
            'abilities.*' => ['string', 'distinct', Rule::in(array_keys(self::ABILITIES))],
            'expires_in_days' => [
                'required',
                'integer',
                Rule::in(array_values(array_filter(self::EXPIRY_DAYS, fn (int $days) => $days <= $maxDays))),
            ],
        ]);

        $token = $request->user()->createToken(
            $validated['name'],
            array_values($validated['abilities']),
            now()->addDays((int) $validated['expires_in_days']),
        );

        return response()->json([
            'token' => $token->plainTextToken,
            'id' => $token->accessToken->id,
        ], 201)->header('Cache-Control', 'no-store, private');
    }

    /**
     * Revoke a token. The next API call made with it fails with 401.
     */
    public function destroy(Request $request, int $token): JsonResponse
    {
        $request->user()->tokens()->whereKey($token)->firstOrFail()->delete();

        return response()->json(['success' => true]);
    }
}
