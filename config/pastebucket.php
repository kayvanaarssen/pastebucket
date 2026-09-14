<?php

return [
    'guest_max_expiry_hours' => (int) env('PASTE_GUEST_MAX_EXPIRY_HOURS', 168), // 7 days
    'user_max_expiry_hours' => (int) env('PASTE_USER_MAX_EXPIRY_HOURS', 8760), // 365 days
    'default_expiry_hours' => (int) env('PASTE_DEFAULT_EXPIRY_HOURS', 24),
    'cleanup_enabled' => env('PASTE_CLEANUP_ENABLED', true),

    /*
    |--------------------------------------------------------------------------
    | Integration API (/api/v1)
    |--------------------------------------------------------------------------
    |
    | Defaults for pastes published by tokens (the MCP server, the CLI, scripts).
    | These never change what the website does: a paste created in the browser
    | still uses default_expiry_hours above.
    |
    | max_content_bytes is measured on the *plaintext*, which the server can
    | compute exactly from the ciphertext length (base64url of plaintext plus a
    | 16-byte GCM tag), so nothing is ever decrypted to enforce it. The request
    | that carries it is about 4/3 larger, so PHP's post_max_size and the web
    | server's body limit (nginx client_max_body_size) must allow at least
    | max_content_bytes * 4 / 3 plus a few kilobytes of JSON. Oversized content
    | is refused with a 413, never truncated.
    |
    */
    'api' => [
        // A missing expiry on an integration publish means seven days, never "unlimited".
        'default_expiry_hours' => (int) env('PASTE_API_DEFAULT_EXPIRY_HOURS', 168),
        'max_content_bytes' => (int) env('PASTE_API_MAX_CONTENT_BYTES', 5 * 1024 * 1024),
        'publish_per_minute' => (int) env('PASTE_API_PUBLISH_PER_MINUTE', 20),
        'requests_per_minute' => (int) env('PASTE_API_REQUESTS_PER_MINUTE', 120),
        'token_max_lifetime_days' => (int) env('PASTE_API_TOKEN_MAX_DAYS', 365),
        // Revoked pastes keep a content-free row so their status can still be
        // reported. They go when they expire, or after this many days at most.
        'revoked_retention_days' => (int) env('PASTE_API_REVOKED_RETENTION_DAYS', 30),
    ],
];
