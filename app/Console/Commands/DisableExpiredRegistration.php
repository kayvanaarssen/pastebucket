<?php

namespace App\Console\Commands;

use App\Models\Setting;
use Carbon\Carbon;
use Illuminate\Console\Command;

class DisableExpiredRegistration extends Command
{
    protected $signature = 'registration:check';
    protected $description = 'Disable registration if the temporary window has expired';

    public function handle(): int
    {
        $until = Setting::registrationUntil();

        if (!$until || !Setting::registrationEnabled()) {
            return self::SUCCESS;
        }

        if (Carbon::parse($until)->isPast()) {
            Setting::set('registration_enabled', 'false');
            Setting::set('registration_until', null);
            $this->info('Registration window expired — registration disabled.');
        }

        return self::SUCCESS;
    }
}
