<?php

namespace App\Http\Controllers;

use App\Mail\InviteMail;
use App\Models\Paste;
use App\Models\Setting;
use App\Models\User;
use App\Models\UserInvite;
use Carbon\Carbon;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rules\Password;
use Inertia\Inertia;

class AdminController extends Controller
{
    public function index(Request $request)
    {
        $search = $request->get('search');

        $pastes = Paste::with('user')
            ->when($search, function ($query, $search) {
                $query->where('title', 'like', "%{$search}%")
                    ->orWhere('slug', 'like', "%{$search}%")
                    ->orWhereHas('user', fn($q) => $q->where('name', 'like', "%{$search}%"));
            })
            ->orderBy('created_at', 'desc')
            ->paginate(25);

        $stats = [
            'total_pastes' => Paste::count(),
            'total_users' => User::count(),
            'active_pastes' => Paste::active()->count(),
            'pastes_today' => Paste::whereDate('created_at', today())->count(),
        ];

        return Inertia::render('Admin/Dashboard', [
            'pastes' => $pastes,
            'stats' => $stats,
            'search' => $search,
            'registration' => [
                'enabled' => Setting::registrationEnabled(),
                'until' => Setting::registrationUntil(),
            ],
        ]);
    }

    public function users(Request $request)
    {
        $users = User::withCount('pastes')
            ->orderBy('created_at', 'desc')
            ->paginate(25);

        $invites = UserInvite::with('inviter:id,name')
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->orderBy('created_at', 'desc')
            ->get()
            ->map(fn ($i) => [
                'id' => $i->id,
                'email' => $i->email,
                'role' => $i->role,
                'expires_at' => $i->expires_at->toISOString(),
                'created_at' => $i->created_at->toISOString(),
                'invited_by' => $i->inviter?->name,
                'url' => url('/invite/' . $i->token),
            ]);

        return Inertia::render('Admin/Users', [
            'users' => $users,
            'invites' => $invites,
        ]);
    }

    public function storeInvite(Request $request)
    {
        $validated = $request->validate([
            'email' => 'required|email|max:255',
            'role' => 'required|in:user,admin',
            'expiry_hours' => 'required|integer|min:1|max:720',
            'send_email' => 'sometimes|boolean',
        ]);

        if (User::where('email', $validated['email'])->exists()) {
            return back()->withErrors(['email' => 'A user with this email already exists.']);
        }

        UserInvite::where('email', $validated['email'])->whereNull('used_at')->delete();

        $invite = UserInvite::create([
            'email' => $validated['email'],
            'token' => Str::random(48),
            'role' => $validated['role'],
            'invited_by' => $request->user()->id,
            'expires_at' => now()->addHours($validated['expiry_hours']),
        ]);

        $message = 'Invite created: ' . url('/invite/' . $invite->token);

        if ($request->boolean('send_email')) {
            try {
                Mail::send(new InviteMail($invite->load('inviter')));
                $message = "Invite created and emailed to {$invite->email}.";
            } catch (\Throwable $e) {
                return back()->with('success', $message . ' (Email failed: ' . $e->getMessage() . ')');
            }
        }

        return back()->with('success', $message);
    }

    public function resendInvite(UserInvite $invite)
    {
        if ($invite->used_at !== null) {
            return back()->withErrors(['error' => 'This invite has already been used.']);
        }

        if ($invite->expires_at->isPast()) {
            return back()->withErrors(['error' => 'This invite has expired. Revoke it and create a new one.']);
        }

        try {
            Mail::send(new InviteMail($invite->load('inviter')));
        } catch (\Throwable $e) {
            return back()->withErrors(['error' => 'Failed to send email: ' . $e->getMessage()]);
        }

        return back()->with('success', "Invite re-sent to {$invite->email}.");
    }

    public function destroyInvite(UserInvite $invite)
    {
        $invite->delete();
        return back()->with('success', 'Invite revoked.');
    }

    public function storeUser(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users',
            'password' => ['required', Password::defaults()],
            'role' => 'required|in:user,admin',
        ]);

        User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'role' => $validated['role'],
        ]);

        return back()->with('success', 'User created.');
    }

    public function updateUser(Request $request, User $user)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users,email,' . $user->id,
            'password' => ['nullable', Password::defaults()],
            'role' => 'required|in:user,admin',
        ]);

        $user->update([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'role' => $validated['role'],
        ]);

        if (!empty($validated['password'])) {
            $user->update(['password' => Hash::make($validated['password'])]);
        }

        return back()->with('success', 'User updated.');
    }

    public function destroyPaste(Paste $paste)
    {
        $paste->delete();
        return back()->with('success', 'Paste deleted.');
    }

    public function destroyUser(User $user)
    {
        if ($user->isAdmin()) {
            return back()->withErrors(['error' => 'Cannot delete admin users.']);
        }
        $user->delete();
        return back()->with('success', 'User deleted.');
    }

    public function toggleAdmin(User $user)
    {
        $user->update([
            'role' => $user->isAdmin() ? 'user' : 'admin',
        ]);
        return back()->with('success', 'User role updated.');
    }

    public function updateRegistration(Request $request)
    {
        $validated = $request->validate([
            'enabled' => 'required|boolean',
            'duration' => 'nullable|integer|min:1',
        ]);

        Setting::set('registration_enabled', $validated['enabled'] ? 'true' : 'false');

        if ($validated['enabled'] && $validated['duration']) {
            Setting::set('registration_until', Carbon::now()->addMinutes($validated['duration'])->toISOString());
        } else {
            Setting::set('registration_until', null);
        }

        $message = $validated['enabled'] ? 'Registration enabled.' : 'Registration disabled.';
        if ($validated['enabled'] && $validated['duration']) {
            $message = "Registration enabled for {$validated['duration']} minutes.";
        }

        return back()->with('success', $message);
    }
}
