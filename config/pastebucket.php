<?php

return [
    'guest_max_expiry_hours' => (int) env('PASTE_GUEST_MAX_EXPIRY_HOURS', 168), // 7 days
    'user_max_expiry_hours' => (int) env('PASTE_USER_MAX_EXPIRY_HOURS', 8760), // 365 days
    'default_expiry_hours' => (int) env('PASTE_DEFAULT_EXPIRY_HOURS', 24),
    'cleanup_enabled' => env('PASTE_CLEANUP_ENABLED', true),
];
