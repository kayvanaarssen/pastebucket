<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\ResolvesOwnPaste;
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

#[Name('get_output_status')]
#[Title('PasteBucket publication status')]
#[Description('Look up the status (active, expired or revoked) and exact expiry of one of your own publications. Accepts a slug or a paste link; only the slug is used.')]
#[IsReadOnly(true)]
#[IsDestructive(false)]
#[IsIdempotent(true)]
#[IsOpenWorld(false)]
class GetOutputStatusTool extends Tool
{
    use ResolvesOwnPaste;

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate(['slug' => ['required', 'string', 'max:2048']]);

        $paste = $this->ownPaste($request->user(), $validated['slug']);

        if (! $paste) {
            return Response::error('Paste not found. It may never have existed, belong to another account, or have been removed after it expired.');
        }

        $status = $this->describe($paste);

        $lines = [
            "Status: {$status['status']}",
            "Created at: {$status['created_at']}",
            'Expires at: '.($status['expires_at'] ? $status['expires_at'].' (UTC)' : 'never'),
        ];

        if ($status['revoked_at']) {
            $lines[] = "Revoked at: {$status['revoked_at']}";
        }

        return Response::make(Response::text(implode("\n", $lines)))->withStructuredContent($status);
    }

    /**
     * @return array<string, \Illuminate\JsonSchema\Types\Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'slug' => $schema->string()->min(1)
                ->description('The paste slug from a previous publish_output result, or its link.')
                ->required(),
        ];
    }
}
