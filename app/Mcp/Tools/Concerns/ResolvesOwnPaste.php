<?php

namespace App\Mcp\Tools\Concerns;

use App\Http\Resources\PasteResource;
use App\Models\Paste;
use Illuminate\Contracts\Auth\Authenticatable;

trait ResolvesOwnPaste
{
    /**
     * Accept a slug or a full paste link. Only the slug is used, so pasting a
     * share link here never does anything with its key.
     */
    protected function slugFrom(string $input): ?string
    {
        $input = trim($input);

        if (preg_match('~/p/([A-Za-z0-9]{16})(?:[/?#]|$)~', $input, $matches)) {
            return $matches[1];
        }

        return preg_match('/^[A-Za-z0-9]{16}$/', $input) ? $input : null;
    }

    /**
     * Someone else's paste looks exactly like a missing one, as on the API.
     */
    protected function ownPaste(Authenticatable $user, string $input): ?Paste
    {
        $slug = $this->slugFrom($input);
        $paste = $slug ? Paste::where('slug', $slug)->first() : null;

        return $paste && $paste->user_id !== null && $paste->user_id === $user->getAuthIdentifier()
            ? $paste
            : null;
    }

    /**
     * @return array<string, mixed>
     */
    protected function describe(Paste $paste): array
    {
        $data = (new PasteResource($paste))->resolve();

        return [
            'slug' => $data['slug'],
            'status' => $data['status'],
            'title' => $data['title'],
            'url' => $data['url'],
            'created_at' => $data['created_at'],
            'expires_at' => $data['expires_at'],
            'revoked_at' => $data['revoked_at'],
            'content_format' => $data['content_format'],
            'visibility' => $data['visibility'],
            'password_protected' => $data['encryption_mode'] === 'password',
        ];
    }
}
