<?php

namespace Tests\Support;

use Laravel\Passport\Passport;

/**
 * Passport signs tokens and builds its authorization server from RSA keys on
 * disk. Tests get throwaway keys so they never touch -- or depend on -- the
 * app's own storage/oauth-*.key (absent on a fresh clone or CI).
 */
trait UsesTemporaryPassportKeys
{
    protected function useTemporaryPassportKeys(): void
    {
        $dir = sys_get_temp_dir().'/pastebucket-passport-'.getmypid();

        if (! is_file("{$dir}/oauth-private.key")) {
            @mkdir($dir, 0700, true);
            $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            openssl_pkey_export($key, $private);
            file_put_contents("{$dir}/oauth-private.key", $private);
            file_put_contents("{$dir}/oauth-public.key", openssl_pkey_get_details($key)['key']);
        }

        // league/oauth2-server refuses group- or world-writable key files.
        chmod("{$dir}/oauth-private.key", 0600);
        chmod("{$dir}/oauth-public.key", 0600);

        Passport::loadKeysFrom($dir);
    }
}
