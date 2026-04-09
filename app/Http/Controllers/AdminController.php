<?php

namespace App\Http\Controllers;

use App\Models\Paste;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
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
        ]);
    }

    public function users(Request $request)
    {
        $users = User::withCount('pastes')
            ->orderBy('created_at', 'desc')
            ->paginate(25);

        return Inertia::render('Admin/Users', [
            'users' => $users,
        ]);
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
}
