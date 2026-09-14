<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\ResolvesOwnPaste;
use App\Services\PasteService;
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

#[Name('revoke_output')]
#[Title('Revoke PasteBucket publication')]
#[Description('Revoke one of your own publications immediately. The link stops working for everyone and the encrypted content is removed. This cannot be undone. Only do this when the user asks.')]
#[IsReadOnly(false)]
#[IsDestructive(true)]
#[IsIdempotent(true)]
#[IsOpenWorld(false)]
class RevokeOutputTool extends Tool
{
    use ResolvesOwnPaste;

    public function __construct(private readonly PasteService $pastes)
    {
    }

    public function handle(Request $request): Response|ResponseFactory
    {
        $validated = $request->validate(['slug' => ['required', 'string', 'max:2048']]);

        $paste = $this->ownPaste($request->user(), $validated['slug']);

        if (! $paste) {
            return Response::error('Paste not found. It may never have existed, belong to another account, or have been removed after it expired.');
        }

        $status = $this->describe($this->pastes->revoke($paste));

        return Response::make(Response::text(
            "Revoked {$status['slug']} at {$status['revoked_at']}. The link no longer works. "
            .'Copies the customer already downloaded or copied are not affected.'
        ))->withStructuredContent($status);
    }

    /**
     * @return array<string, \Illuminate\JsonSchema\Types\Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'slug' => $schema->string()->min(1)
                ->description('The paste slug to revoke, or its link.')
                ->required(),
        ];
    }
}
