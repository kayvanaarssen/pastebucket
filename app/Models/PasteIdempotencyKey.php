<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PasteIdempotencyKey extends Model
{
    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'key',
        'request_hash',
        'paste_id',
        'expires_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
        ];
    }

    public function paste(): BelongsTo
    {
        return $this->belongsTo(Paste::class);
    }
}
