<?php

namespace Tests\Support;

use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;

/**
 * Decrypt server-produced envelopes with the real browser crypto core.
 *
 * Runs resources/js/lib/crypto-core.ts in Node (22.18+ strips its types), so a
 * passing assertion means the website's own decryption path opens what the
 * PHP side encrypted -- not merely that PHP agrees with itself.
 */
trait DecryptsWithCryptoCore
{
    protected function requireNode(): void
    {
        if ((new ExecutableFinder)->find('node') === null) {
            $this->markTestSkipped('Node is required to decrypt with crypto-core.ts.');
        }
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    protected function decryptWithCryptoCore(string $content, array $meta, ?string $fragmentKey, ?string $password = null): string
    {
        $this->requireNode();

        $core = 'file://'.base_path('resources/js/lib/crypto-core.ts');
        $script = <<<JS
            import { decryptWithFragmentKey, decryptWithPassword } from '{$core}';
            let input = '';
            for await (const chunk of process.stdin) input += chunk;
            const e = JSON.parse(input);
            const plaintext = e.password
                ? await decryptWithPassword(e.content, e.meta, e.password)
                : await decryptWithFragmentKey(e.content, e.meta, e.key);
            process.stdout.write(Buffer.from(plaintext, 'utf8').toString('base64'));
            JS;

        $process = new Process(['node', '--no-warnings', '--input-type=module', '-e', $script]);
        $process->setInput(json_encode([
            'content' => $content,
            'meta' => $meta,
            'key' => $fragmentKey,
            'password' => $password,
        ]));
        $process->setTimeout(60);
        $process->mustRun();

        return base64_decode($process->getOutput(), true);
    }
}
