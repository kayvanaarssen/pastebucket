<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('registration:check')->everyMinute();
// Expiry is enforced on every request the moment it is reached; this only
// removes rows (and idempotency records) that have already stopped being served.
Schedule::command('pastes:clean')->hourly();
Schedule::command('sanctum:prune-expired --hours=24')->daily();
