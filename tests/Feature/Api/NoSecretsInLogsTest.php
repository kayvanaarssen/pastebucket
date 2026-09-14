<?php

namespace Tests\Feature\Api;

use App\Models\User;
use App\Services\PasteService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Tests\Support\EncryptedPayloads;
use Tests\TestCase;

/**
 * Nothing secret may surface in logs or error responses, including when the
 * server fails halfway through a publish.
 *
 * The client never sends plaintext, fragment keys or passwords -- so the
 * scenarios below deliberately misbehave and send them anyway, to prove the
 * server does not repeat them either.
 */
class NoSecretsInLogsTest extends TestCase
{
    use EncryptedPayloads, RefreshDatabase;

    private string $logPath;

    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->logPath = storage_path('logs/test-no-secrets-'.getmypid().'.log');
        File::delete($this->logPath);

        config([
            'app.debug' => false,
            'logging.default' => 'single',
            'logging.channels.single.path' => $this->logPath,
        ]);
        app('log')->forgetChannel('single');

        app('events')->listen(MessageLogged::class, function (MessageLogged $event) {
            $this->logged[] = $event->message.' '.print_r($event->context, true);
        });
    }

    protected function tearDown(): void
    {
        File::delete($this->logPath);

        parent::tearDown();
    }

    public function test_failures_do_not_leak_tokens_keys_passwords_or_plaintext(): void
    {
        $user = User::factory()->create();
        $token = $this->tokenFor($user);
        [, $tokenSecret] = explode('|', $token, 2);

        $fragmentKey = 'FRAGMENT-KEY-u8GkQn3v0T1b2c3d4e5f6g7h8i9j0kLmNoPq';
        $password = 'PASSWORD-correct-horse-battery';
        $plaintext = 'PLAINTEXT-Geheime offerte voor Fictief BV';

        $responses = [];

        // The server itself failing mid-publish. First, because the router
        // keeps the controller instance (and its injected service) once built.
        $this->mock(PasteService::class, function ($mock) {
            $mock->shouldReceive('maxExpiryHoursFor')->andReturn(8760);
            $mock->shouldReceive('create')->andThrow(new RuntimeException('Database went away'));
        });
        $responses[] = $this->publish($token, ['title' => 'Shared document']);

        // Secret fields sent by a broken client.
        $responses[] = $this->publish($token, ['password' => $password, 'fragment_key' => $fragmentKey, 'plaintext' => $plaintext]);

        // A wrong token that is nearly right.
        $responses[] = $this->publish(substr($token, 0, -1).'x');

        $this->assertSame([500, 422, 401], array_map(fn ($r) => $r->getStatusCode(), $responses));

        $haystacks = [
            ...array_map(fn ($r) => $r->getContent(), $responses),
            ...$this->logged,
            File::exists($this->logPath) ? File::get($this->logPath) : '',
        ];

        $this->assertNotEmpty($this->logged, 'the 500 should have been logged, or this test proves nothing');

        foreach ($haystacks as $haystack) {
            foreach ([$tokenSecret, $fragmentKey, $password, $plaintext] as $secret) {
                $this->assertStringNotContainsString($secret, $haystack);
            }
        }
    }
}
