<?php

namespace App\Http\Resources;

use App\Models\Paste;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Paste
 */
class PasteResource extends JsonResource
{
    /**
     * The same shape for create, status and revoke. `url` is the paste's
     * address *without* any key -- the client that holds the key appends it as
     * a fragment itself, so the server never has anything to leak.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'slug' => $this->slug,
            'url' => url('/p/'.$this->slug),
            'title' => $this->title,
            'created_at' => $this->created_at?->toISOString(),
            'expires_at' => $this->expires_at?->toISOString(),
            'content_format' => $this->contentFormat(),
            'language' => $this->language,
            'visibility' => $this->visibility,
            'burn_after_read' => (bool) $this->burn_after_read,
            'encryption_mode' => $this->encryption_meta['mode'] ?? null,
            'status' => $this->status(),
            'revoked_at' => $this->revoked_at?->toISOString(),
        ];
    }
}
