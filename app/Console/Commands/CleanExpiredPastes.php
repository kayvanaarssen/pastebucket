<?php

namespace App\Console\Commands;

use App\Models\Paste;
use App\Models\PasteIdempotencyKey;
use Illuminate\Console\Command;

/**
 * Housekeeping, not enforcement.
 *
 * Every route refuses an expired or revoked paste on its own the moment the
 * boundary is reached, so a late or skipped run never keeps a link alive. This
 * only deletes rows that are already unreachable. Database backups taken before
 * a run still hold the (encrypted) rows until those backups rotate out.
 */
class CleanExpiredPastes extends Command
{
    protected $signature = 'pastes:clean';
    protected $description = 'Delete expired and long-revoked pastes, and stale idempotency records';

    public function handle(): int
    {
        if (!config('pastebucket.cleanup_enabled')) {
            $this->info('Paste cleanup is disabled.');
            return self::SUCCESS;
        }

        $now = now();

        $expired = Paste::where('expires_at', '<=', $now)->delete();

        $revoked = Paste::whereNotNull('revoked_at')
            ->where('revoked_at', '<=', $now->copy()->subDays((int) config('pastebucket.api.revoked_retention_days')))
            ->delete();

        $keys = PasteIdempotencyKey::where('expires_at', '<=', $now)->delete();

        $this->info("Deleted {$expired} expired paste(s), {$revoked} revoked paste record(s) and {$keys} idempotency record(s).");

        return self::SUCCESS;
    }
}
