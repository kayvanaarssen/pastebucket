<?php

namespace App\Console\Commands;

use App\Models\Paste;
use Illuminate\Console\Command;

class CleanExpiredPastes extends Command
{
    protected $signature = 'pastes:clean';
    protected $description = 'Delete expired pastes';

    public function handle(): int
    {
        if (!config('pastebucket.cleanup_enabled')) {
            $this->info('Paste cleanup is disabled.');
            return self::SUCCESS;
        }

        $count = Paste::where('expires_at', '<', now())->delete();
        $this->info("Deleted {$count} expired paste(s).");

        return self::SUCCESS;
    }
}
