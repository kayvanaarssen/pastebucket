<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Paste extends Model
{
    /**
     * How the decrypted content is meant to be read.
     *
     * code     - the original editor: shown verbatim with syntax highlighting
     *            chosen by `language` (a `markdown` language keeps its old
     *            Source/Formatted toggle). Every paste before this column.
     * markdown - a document: GitHub-flavoured Markdown rendered as a readable
     *            page, edited with the visual editor. Rich text is stored as
     *            Markdown, so publishing Markdown keeps it byte for byte.
     *
     * The format is stored on its own rather than inferred from `language`,
     * which only ever described highlighting.
     */
    public const CONTENT_FORMATS = ['code', 'markdown'];

    public const STATUS_ACTIVE = 'active';

    public const STATUS_EXPIRED = 'expired';

    public const STATUS_REVOKED = 'revoked';

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'slug',
        'short_code_hash',
        'short_meta',
        'user_id',
        'title',
        'content',
        'content_format',
        'encryption_version',
        'encryption_meta',
        'language',
        'password',
        'visibility',
        'expires_at',
        'revoked_at',
        'burn_after_read',
        'views',
        'ip_address',
        'created_via',
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
            'revoked_at' => 'datetime',
            'burn_after_read' => 'boolean',
            'encryption_meta' => 'array',
            'short_meta' => 'array',
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
     * Scope a query to pastes that can still be served: not expired, not revoked.
     *
     * The boundary matches isExpired(): a paste is gone *at* its expiry moment.
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('revoked_at')->where(function (Builder $query) {
            $query->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
        });
    }

    /**
     * Determine if the paste has expired.
     *
     * Inclusive on purpose. "Valid for seven days" ends at the stated moment,
     * not one clock tick after it, and every route asks this same question so
     * none of them can serve a paste the others already refuse.
     */
    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->lessThanOrEqualTo(now());
    }

    /**
     * Determine if the owner withdrew the paste. A revoked paste keeps only its
     * metadata row -- the ciphertext is wiped at revocation.
     */
    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    public function status(): string
    {
        return match (true) {
            $this->isRevoked() => self::STATUS_REVOKED,
            $this->isExpired() => self::STATUS_EXPIRED,
            default => self::STATUS_ACTIVE,
        };
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

    /** Rows from before the column existed read as the original code format. */
    public function contentFormat(): string
    {
        return $this->content_format ?? 'code';
    }
}
