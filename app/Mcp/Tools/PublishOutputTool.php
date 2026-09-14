<?php

namespace App\Mcp\Tools;

use App\Services\PasteService;
use App\Support\ServerSideEncryption;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Title;
use Laravel\Mcp\Server\Tool;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsIdempotent;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[Name('publish_output')]
#[Title('Publish to PasteBucket')]
#[Description('Publish Markdown as an unlisted, encrypted PasteBucket document and return the customer link (including its decryption key) and the exact expiry. Pass the verbatim text the user designated; it is never summarised or truncated. The link is not sent to anyone.')]
#[IsReadOnly(false)]
#[IsDestructive(false)]
#[IsIdempotent(false)]
#[IsOpenWorld(true)]
class PublishOutputTool extends Tool
{
    public const DEFAULT_TITLE = 'Shared document';

    public function __construct(private readonly PasteService $pastes)
    {
    }

    public function handle(Request $request): Response|ResponseFactory
    {
        $user = $request->user();
        $maxDays = max(1, intdiv($this->pastes->maxExpiryHoursFor($user), 24));

        $validated = $request->validate([
            'title' => ['nullable', 'string', 'max:255'],
            'markdown' => ['required', 'string'],
            'expires_in_days' => ['nullable', 'integer', 'min:1', "max:{$maxDays}"],
            'password' => ['nullable', 'string', 'min:8'],
        ], [
            'expires_in_days.max' => "The expiry may be at most {$maxDays} days for this account.",
            'expires_in_days.min' => 'The expiry must be at least 1 day. Publications cannot be unlimited.',
            'title.max' => 'The title may be at most 255 characters. It was not shortened.',
        ]);

        $markdown = $validated['markdown'];

        if (trim($markdown) === '') {
            return Response::error('There is no content to publish.');
        }

        // Refused whole, never truncated.
        $bytes = strlen($markdown);
        $maxBytes = (int) config('pastebucket.api.max_content_bytes');

        if ($bytes > $maxBytes) {
            return Response::error("Content is {$bytes} bytes; the maximum is {$maxBytes} bytes. Nothing was published or truncated.");
        }

        $days = (int) ($validated['expires_in_days'] ?? intdiv((int) config('pastebucket.api.default_expiry_hours'), 24));
        $password = $validated['password'] ?? null;
        $title = filled($validated['title'] ?? null) ? $validated['title'] : self::DEFAULT_TITLE;

        $encrypted = ServerSideEncryption::encrypt($markdown, $password);
        unset($markdown, $validated);

        $paste = $this->pastes->create([
            'user_id' => $user->getAuthIdentifier(),
            'title' => $title,
            'content' => $encrypted['content'],
            'content_format' => 'markdown',
            'language' => 'markdown',
            'encryption_version' => $encrypted['encryption_version'],
            'encryption_meta' => $encrypted['encryption_meta'],
            'password' => null,
            'visibility' => 'unlisted',
            'expires_at' => now()->startOfSecond()->addDays($days),
            'burn_after_read' => false,
            'ip_address' => request()->ip(),
            'created_via' => 'mcp',
        ]);

        $url = url('/p/'.$paste->slug);
        $shareUrl = $encrypted['fragment_key'] !== null ? $url.'#k='.$encrypted['fragment_key'] : $url;
        $expiresAt = $paste->expires_at->toISOString();

        $lines = [
            "Published {$bytes} bytes verbatim to PasteBucket.",
            "Link: {$shareUrl}",
            "Expires at: {$expiresAt} (UTC)",
            "Slug: {$paste->slug}",
            'The link has not been sent to anyone. Share it with the customer yourself.',
        ];

        if ($password !== null) {
            $lines[] = 'The document is password-protected: share the password through a different channel than the link.';
        }

        return Response::make(Response::text(implode("\n", $lines)))->withStructuredContent([
            'share_url' => $shareUrl,
            'slug' => $paste->slug,
            'expires_at' => $expiresAt,
            'created_at' => $paste->created_at->toISOString(),
            'content_format' => 'markdown',
            'password_protected' => $password !== null,
        ]);
    }

    /**
     * @return array<string, \Illuminate\JsonSchema\Types\Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'title' => $schema->string()->max(255)
                ->description('Neutral title. Stored UNENCRYPTED; no customer names or secrets. Defaults to "Shared document".'),
            'markdown' => $schema->string()->min(1)
                ->description('The exact Markdown to publish, verbatim.')
                ->required(),
            'expires_in_days' => $schema->integer()->min(1)->default(7)
                ->description('Days until the link stops working. Defaults to 7.'),
            'password' => $schema->string()->min(8)
                ->description('Optional password. The link then carries no key and the reader must enter this password.'),
        ];
    }
}
