<?php

use App\Http\Controllers\Api\V1\PasteController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Integration API, version 1
|--------------------------------------------------------------------------
|
| Personal access tokens only (Sanctum, with its session guard disabled in
| config/sanctum.php), so there is no cookie, session or CSRF path in here.
| Every token carries explicit abilities, and every paste route additionally
| checks that the token's user owns the paste.
|
| The server only ever receives ciphertext and non-secret envelope fields.
|
*/

Route::prefix('v1')
    ->middleware(['auth:sanctum', 'throttle:pastebucket-api', 'shared-content'])
    ->group(function () {
        Route::get('limits', [PasteController::class, 'limits'])->name('api.v1.limits');

        Route::post('pastes', [PasteController::class, 'store'])
            ->middleware(['abilities:pastes:create', 'throttle:pastebucket-api-publish'])
            ->name('api.v1.pastes.store');

        Route::get('pastes/{slug}', [PasteController::class, 'show'])
            ->middleware('abilities:pastes:read')
            ->where('slug', '[A-Za-z0-9]{16}')
            ->name('api.v1.pastes.show');

        Route::delete('pastes/{slug}', [PasteController::class, 'destroy'])
            ->middleware('abilities:pastes:revoke')
            ->where('slug', '[A-Za-z0-9]{16}')
            ->name('api.v1.pastes.revoke');
    });
