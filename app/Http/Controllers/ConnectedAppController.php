<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Passport\Token;

/**
 * OAuth clients (ChatGPT and the like) the user approved on /oauth/authorize.
 *
 * A connection lives as long as it holds a usable access token or refresh
 * token. Disconnecting revokes both for that client, so the next MCP call
 * fails and the client has to ask for approval again.
 */
class ConnectedAppController extends Controller
{
    /**
     * @return list<array<string, mixed>>
     */
    public static function appsFor(Request $request): array
    {
        return Token::query()
            ->with(['client', 'refreshToken'])
            ->where('user_id', $request->user()->getAuthIdentifier())
            ->where('revoked', false)
            ->get()
            ->filter(fn (Token $token) => $token->expires_at?->isFuture()
                || ($token->refreshToken && ! $token->refreshToken->revoked && $token->refreshToken->expires_at?->isFuture()))
            ->groupBy('client_id')
            ->map(fn ($tokens, $clientId) => [
                'id' => (string) $clientId,
                'name' => $tokens->first()->client?->name ?? 'Unknown app',
                'connected_at' => $tokens->min('created_at')?->toISOString(),
                'last_authorized_at' => $tokens->max('created_at')?->toISOString(),
            ])
            ->values()
            ->all();
    }

    public function destroy(Request $request, string $client): JsonResponse
    {
        $tokens = Token::query()
            ->with('refreshToken')
            ->where('user_id', $request->user()->getAuthIdentifier())
            ->where('client_id', $client)
            ->get();

        abort_if($tokens->isEmpty(), 404);

        foreach ($tokens as $token) {
            $token->revoke();
            $token->refreshToken?->forceFill(['revoked' => true])->save();
        }

        return response()->json(['success' => true]);
    }
}
