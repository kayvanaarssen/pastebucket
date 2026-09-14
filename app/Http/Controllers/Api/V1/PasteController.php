<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\StorePasteRequest;
use App\Http\Resources\PasteResource;
use App\Models\Paste;
use App\Models\PasteIdempotencyKey;
use App\Services\PasteService;
use App\Support\EncryptionEnvelope;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

class PasteController extends Controller
{
    private const IDEMPOTENCY_KEY_PATTERN = '/^[A-Za-z0-9_.:-]{1,100}$/';

    public function __construct(private readonly PasteService $pastes)
    {
    }

    /**
     * What this server will accept, so a client can refuse oversized content
     * or an out-of-range expiry before it encrypts anything.
     */
    public function limits(Request $request): JsonResponse
    {
        return response()->json(['data' => [
            'max_content_bytes' => (int) config('pastebucket.api.max_content_bytes'),
            'default_expiry_hours' => (int) config('pastebucket.api.default_expiry_hours'),
            'max_expiry_hours' => $this->pastes->maxExpiryHoursFor($request->user()),
            'min_expiry_hours' => 1,
            'content_formats' => Paste::CONTENT_FORMATS,
            'encryption_versions' => [EncryptionEnvelope::VERSION],
        ]]);
    }

    /**
     * Publish an already-encrypted paste.
     *
     * Integration defaults differ from the website on purpose: unlisted, a
     * Markdown document, seven days, readable more than once. A retry with the
     * same Idempotency-Key and body returns the original paste -- including its
     * original expiry -- rather than creating a second one.
     */
    public function store(StorePasteRequest $request): JsonResponse
    {
        $key = $request->header('Idempotency-Key');

        if ($key !== null && ! preg_match(self::IDEMPOTENCY_KEY_PATTERN, $key)) {
            return response()->json([
                'message' => 'The Idempotency-Key header must be 1-100 characters of A-Z, a-z, 0-9, _ . : -',
                'errors' => ['idempotency_key' => ['The Idempotency-Key header is malformed.']],
            ], 422);
        }

        $validated = $request->validated();

        // Checked on the ciphertext, whose length fixes the plaintext size
        // exactly. Refused whole: content is never truncated to fit.
        $contentBytes = EncryptionEnvelope::plaintextBytes($validated['content']);
        $maxBytes = (int) config('pastebucket.api.max_content_bytes');

        if ($contentBytes > $maxBytes) {
            return response()->json([
                'message' => "Content is {$contentBytes} bytes; the maximum is {$maxBytes} bytes. Nothing was stored.",
                'error' => 'payload_too_large',
                'content_bytes' => $contentBytes,
                'max_content_bytes' => $maxBytes,
            ], 413);
        }

        $user = $request->user();
        $requestHash = $this->hashRequest($validated);

        if ($key !== null) {
            $existing = PasteIdempotencyKey::where('user_id', $user->id)->where('key', $key)->first();

            if ($existing) {
                return $this->replay($existing, $requestHash);
            }
        }

        $format = $validated['content_format'] ?? 'markdown';
        $hours = (int) ($validated['expires_in_hours'] ?? config('pastebucket.api.default_expiry_hours'));

        try {
            $paste = DB::transaction(function () use ($validated, $user, $request, $format, $hours, $key, $requestHash) {
                $paste = $this->pastes->create([
                    'user_id' => $user->id,
                    'title' => $validated['title'] ?? null,
                    'content' => $validated['content'],
                    'content_format' => $format,
                    // Markdown documents always highlight as markdown when
                    // someone flips to the source view.
                    'language' => $format === 'markdown' ? 'markdown' : ($validated['language'] ?? 'text'),
                    'encryption_version' => $validated['encryption_version'],
                    'encryption_meta' => $validated['encryption_meta'],
                    'password' => null,
                    'visibility' => $validated['visibility'] ?? 'unlisted',
                    // Whole seconds, so the moment reported here is exactly the
                    // one the database stores and every route enforces.
                    'expires_at' => now()->startOfSecond()->addHours($hours),
                    'burn_after_read' => $validated['burn_after_read'] ?? false,
                    'ip_address' => $request->ip(),
                    'created_via' => 'api',
                ]);

                if ($key !== null) {
                    PasteIdempotencyKey::create([
                        'user_id' => $user->id,
                        'key' => $key,
                        'request_hash' => $requestHash,
                        'paste_id' => $paste->id,
                        'expires_at' => $paste->expires_at,
                    ]);
                }

                return $paste;
            });
        } catch (UniqueConstraintViolationException $e) {
            // Two requests with one key raced; the other committed first. Its
            // paste is the answer to this request too.
            $existing = PasteIdempotencyKey::where('user_id', $user->id)->where('key', $key)->first();

            if (! $existing) {
                throw $e;
            }

            return $this->replay($existing, $requestHash);
        }

        return (new PasteResource($paste->refresh()))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $slug): PasteResource
    {
        return new PasteResource($this->ownedPaste($request, $slug));
    }

    /**
     * Revoke a paste: the link stops working at once and the ciphertext is
     * wiped. Repeating it is harmless and answers the same way.
     */
    public function destroy(Request $request, string $slug): PasteResource
    {
        return new PasteResource($this->pastes->revoke($this->ownedPaste($request, $slug)));
    }

    /**
     * Someone else's paste is indistinguishable from a missing one, so a token
     * cannot be used to probe which slugs exist.
     */
    private function ownedPaste(Request $request, string $slug): Paste
    {
        $paste = Paste::where('slug', $slug)->first();

        if (! $paste || $request->user()->cannot('manage', $paste)) {
            abort(response()->json(['message' => 'Paste not found.'], 404));
        }

        return $paste;
    }

    private function replay(PasteIdempotencyKey $record, string $requestHash): JsonResponse
    {
        if (! hash_equals($record->request_hash, $requestHash)) {
            return response()->json([
                'message' => 'This Idempotency-Key was already used with a different request. Use a new key for new content.',
                'error' => 'idempotency_key_reused',
            ], 409);
        }

        $paste = $record->paste;

        if (! $paste) {
            return response()->json([
                'message' => 'The paste created with this Idempotency-Key no longer exists. Nothing was created.',
                'error' => 'idempotency_paste_gone',
            ], 410);
        }

        return (new PasteResource($paste))->response()
            ->setStatusCode(200)
            ->header('Idempotent-Replayed', 'true');
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function hashRequest(array $validated): string
    {
        $canonical = function (array $value) use (&$canonical): array {
            ksort($value);

            return array_map(fn ($item) => is_array($item) ? $canonical($item) : $item, $value);
        };

        return hash('sha256', json_encode($canonical(Arr::except($validated, StorePasteRequest::SECRET_FIELDS))));
    }
}
