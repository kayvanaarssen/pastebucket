<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Passport\Contracts\OAuthenticatable;
use Laravel\Passport\HasApiTokens;

/**
 * A user as seen by the OAuth guard.
 *
 * Sanctum (personal tokens for /api) and Passport (OAuth tokens for the remote
 * MCP endpoint) both ship a HasApiTokens trait with the same method names and
 * incompatible $accessToken declarations, so one class -- or a subclass of
 * User -- cannot carry both. This is a separate, deliberately thin model over
 * the same users table. Only the `api` guard's provider resolves it; the rest
 * of the app keeps using User with Sanctum.
 */
#[Hidden(['password', 'remember_token'])]
class OAuthUser extends Authenticatable implements OAuthenticatable
{
    use HasApiTokens;

    protected $table = 'users';
}
