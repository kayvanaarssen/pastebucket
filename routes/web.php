<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\PasskeyController;
use App\Http\Controllers\PasteController;
use App\Http\Controllers\ProfileController;
use App\Http\Middleware\AdminMiddleware;
use Illuminate\Support\Facades\Route;

// Home / Create paste
Route::get('/', [PasteController::class, 'index'])->name('home');
Route::post('/paste', [PasteController::class, 'store'])->name('paste.store');

// Auth routes
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'showLogin'])->name('login');
    Route::post('/login', [AuthController::class, 'login']);
    Route::get('/register', [AuthController::class, 'showRegister'])->name('register');
    Route::post('/register', [AuthController::class, 'register']);

    // Passkey authentication (guest)
    Route::post('/passkey/authenticate/options', [PasskeyController::class, 'authenticateOptions']);
    Route::post('/passkey/authenticate', [PasskeyController::class, 'authenticate']);

    // Invite acceptance (public)
    Route::get('/invite/{token}', [InviteController::class, 'show'])->name('invite.show');
    Route::post('/invite/{token}', [InviteController::class, 'accept'])->name('invite.accept');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');
    Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/profile', [ProfileController::class, 'index'])->name('profile');
    Route::put('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::put('/profile/password', [ProfileController::class, 'updatePassword'])->name('profile.password');

    // Passkey management (authenticated)
    Route::get('/passkeys', [PasskeyController::class, 'index']);
    Route::post('/passkey/register/options', [PasskeyController::class, 'registerOptions']);
    Route::post('/passkey/register', [PasskeyController::class, 'register']);
    Route::delete('/passkey/{passkey}', [PasskeyController::class, 'destroy']);

    // Admin routes
    Route::middleware(AdminMiddleware::class)->prefix('admin')->name('admin.')->group(function () {
        Route::get('/', [AdminController::class, 'index'])->name('dashboard');
        Route::get('/users', [AdminController::class, 'users'])->name('users');
        Route::delete('/paste/{paste}', [AdminController::class, 'destroyPaste'])->name('paste.destroy');
        Route::post('/user', [AdminController::class, 'storeUser'])->name('user.store');
        Route::put('/user/{user}', [AdminController::class, 'updateUser'])->name('user.update');
        Route::delete('/user/{user}', [AdminController::class, 'destroyUser'])->name('user.destroy');
        Route::post('/user/{user}/toggle-admin', [AdminController::class, 'toggleAdmin'])->name('user.toggle-admin');
        Route::post('/registration', [AdminController::class, 'updateRegistration'])->name('registration.update');
        Route::post('/invite', [AdminController::class, 'storeInvite'])->name('invite.store');
        Route::post('/invite/{invite}/resend', [AdminController::class, 'resendInvite'])->name('invite.resend');
        Route::delete('/invite/{invite}', [AdminController::class, 'destroyInvite'])->name('invite.destroy');
    });
});

// Paste routes (must be last due to catch-all slug)
Route::get('/p/{slug}', [PasteController::class, 'show'])->name('paste.show');
Route::post('/p/{slug}/verify', [PasteController::class, 'verifyPassword'])->name('paste.verify');
Route::get('/p/{slug}/raw', [PasteController::class, 'showRaw'])->name('paste.raw');
Route::delete('/p/{slug}', [PasteController::class, 'destroy'])->name('paste.destroy')->middleware('auth');
