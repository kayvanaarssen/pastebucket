<?php

namespace App\Http\Requests\Api;

use App\Models\Paste;
use App\Services\PasteService;
use App\Support\EncryptionEnvelope;
use Illuminate\Foundation\Http\FormRequest;

class StorePasteRequest extends FormRequest
{
    /**
     * Fields that could only ever carry a secret. Refused outright, so a client
     * bug that tries to send one fails loudly instead of being quietly ignored
     * -- and the value is never echoed back in the error.
     */
    public const SECRET_FIELDS = ['password', 'key', 'fragment_key', 'encryption_key', 'plaintext'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $maxHours = app(PasteService::class)->maxExpiryHoursFor($this->user());

        return [
            'title' => ['nullable', 'string', 'max:255'],
            'content_format' => ['sometimes', 'string', 'in:'.implode(',', Paste::CONTENT_FORMATS)],
            'language' => ['nullable', 'string', 'max:50', 'regex:/^[A-Za-z0-9+#._-]+$/'],
            'visibility' => ['sometimes', 'string', 'in:unlisted,private,public'],
            'expires_in_hours' => ['sometimes', 'integer', 'min:1', 'max:'.$maxHours],
            'burn_after_read' => ['sometimes', 'boolean'],
            ...EncryptionEnvelope::strictRules(),
            ...array_fill_keys(self::SECRET_FIELDS, 'prohibited'),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        $maxHours = app(PasteService::class)->maxExpiryHoursFor($this->user());

        return [
            'content.regex' => 'The content must be base64url ciphertext produced by the Pastebucket client.',
            'content.min' => 'The content is too short to be AES-GCM ciphertext.',
            'expires_in_hours.max' => "The expiry may be at most {$maxHours} hours (".intdiv($maxHours, 24).' days) for this account.',
            'expires_in_hours.min' => 'The expiry must be at least 1 hour. Integration publishes cannot be unlimited.',
            'encryption_meta.array' => 'The encryption_meta object may only contain mode, iv, salt, iterations, wrapped_key and wrap_iv.',
            '*.prohibited' => 'Secrets must never be sent to the server. Encrypt locally and keep the key and password on the client.',
        ];
    }
}
