<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Paste extends Model
{
    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'slug',
        'short_code',
        'user_id',
        'title',
        'content',
        'encryption_version',
        'encryption_meta',
        'language',
        'password',
        'visibility',
        'expires_at',
        'burn_after_read',
        'views',
        'ip_address',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'ip_address',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'burn_after_read' => 'boolean',
            'encryption_meta' => 'array',
        ];
    }

    /**
     * Get the route key for the model.
     */
    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /**
     * Get the user that owns the paste.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Scope a query to only include non-expired pastes.
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where(function (Builder $query) {
            $query->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
        });
    }

    /**
     * Determine if the paste has expired.
     */
    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /**
     * Determine if the paste is password protected.
     *
     * For encrypted pastes this is a property of the envelope: the content key
     * is wrapped under a password-derived key, so the server has no password to
     * check. Legacy pastes fall back to the old server-side password column.
     */
    public function isPasswordProtected(): bool
    {
        if ($this->isEncrypted()) {
            return ($this->encryption_meta['mode'] ?? null) === 'password';
        }

        return $this->password !== null;
    }

    /**
     * Determine whether the given viewer owns this paste.
     *
     * Guests who create a paste are remembered by session, so they keep owner
     * rights over something they never had an account for.
     */
    public function isOwnedByViewer(): bool
    {
        return (auth()->check() && auth()->id() === $this->user_id)
            || session("paste_creator_{$this->slug}", false);
    }

    /**
     * Determine if the paste content is end-to-end encrypted.
     *
     * Pastes created before E2E landed have a null version and remain stored as
     * plaintext; they cannot be upgraded server-side without a key.
     */
    public function isEncrypted(): bool
    {
        return $this->encryption_version !== null;
    }
}
