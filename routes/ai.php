<?php

use App\Mcp\Servers\PastebucketServer;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;

/*
|--------------------------------------------------------------------------
| Remote MCP endpoint (ChatGPT and other OAuth MCP clients)
|--------------------------------------------------------------------------
|
| Loaded by laravel/mcp outside the web middleware group: MCP clients send no
| cookies and no CSRF token. They authenticate with OAuth 2.1 access tokens
| issued by Passport after the user logs in and approves the client on
| /oauth/authorize, which does run with the normal session and CSRF checks.
|
| Unlike the website, the CLI and the local MCP server, this endpoint receives
| plaintext and encrypts it on the server. See docs/chatgpt.md.
|
*/

Route::middleware('throttle:pastebucket-oauth-register')->group(function () {
    // Discovery metadata and dynamic client registration (RFC 7591).
    Mcp::oauthRoutes();
});

Mcp::web('/mcp', PastebucketServer::class)
    ->middleware(['auth:api', 'throttle:pastebucket-mcp', 'shared-content']);
