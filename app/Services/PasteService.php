<?php

namespace App\Services;

use App\Models\Paste;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Str;

/**
 * Storage rules shared by the browser controller and the API, so the two entry
 * points cannot drift on slugs, expiry limits or what revocation removes.
 */
class PasteService
{
    /**
     * The longest expiry this account may set, in hours. Tokens always belong
     * to a user, so the API is held to the same limit as a logged-in browser.
     */
    public function maxExpiryHoursFor(?Authenticatable $user): int
    {
        return (int) ($user
            ? config('pastebucket.user_max_expiry_hours')
            : config('pastebucket.guest_max_expiry_hours'));
    }

    public function generateUniqueSlug(): string
    {
        do {
            $slug = Str::random(16);
        } while (Paste::where('slug', $slug)->exists());

        return $slug;
    }

    /**
     * Persist a paste whose attributes have already been validated.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function create(array $attributes): Paste
    {
        return Paste::create([
            'slug' => $this->generateUniqueSlug(),
            'content_format' => 'code',
            'created_via' => 'web',
            ...$attributes,
        ]);
    }

    /**
     * Withdraw a paste for good.
     *
     * The ciphertext and everything needed to open it are wiped in the same
     * write, so a revoked paste cannot be brought back by a bug in some route's
     * access check. The row stays, content-free, so its owner can still see
     * that it was revoked; pastes:clean removes it later.
     */
    public function revoke(Paste $paste): Paste
    {
        if ($paste->isRevoked()) {
            return $paste;
        }

        $paste->forceFill([
            'revoked_at' => now(),
            'content' => '',
            'encryption_meta' => null,
            'short_code_hash' => null,
            'short_meta' => null,
            'password' => null,
        ])->save();

        return $paste;
    }
}
