<?php

namespace App\Http\Controllers;

use App\Models\Paste;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;

class PasteController extends Controller
{
    public function index()
    {
        return Inertia::render('Home', [
            'defaultExpiry' => config('pastebucket.default_expiry_hours'),
            'maxExpiry' => auth()->check()
                ? config('pastebucket.user_max_expiry_hours')
                : config('pastebucket.guest_max_expiry_hours'),
            'isAuthenticated' => auth()->check(),
        ]);
    }

    public function store(Request $request)
    {
        $maxExpiry = auth()->check()
            ? config('pastebucket.user_max_expiry_hours')
            : config('pastebucket.guest_max_expiry_hours');

        $validated = $request->validate([
            'title' => 'nullable|string|max:255',
            'content' => 'required|string',
            'language' => 'nullable|string|max:50',
            'password' => 'nullable|string|min:1',
            'visibility' => 'required|in:public,unlisted,private',
            'expiry_hours' => "nullable|numeric|min:1|max:{$maxExpiry}",
            'burn_after_read' => 'boolean',
        ]);

        // Only logged-in users can create private pastes
        if ($validated['visibility'] === 'private' && !auth()->check()) {
            $validated['visibility'] = 'unlisted';
        }

        $slug = $this->generateUniqueSlug();

        $paste = Paste::create([
            'slug' => $slug,
            'user_id' => auth()->id(),
            'title' => $validated['title'],
            'content' => $validated['content'],
            'language' => $validated['language'],
            'password' => $validated['password'] ? Hash::make($validated['password']) : null,
            'visibility' => $validated['visibility'],
            'expires_at' => $validated['expiry_hours'] ? now()->addHours($validated['expiry_hours']) : null,
            'burn_after_read' => $validated['burn_after_read'] ?? false,
            'ip_address' => $request->ip(),
        ]);

        return redirect()->route('paste.show', $paste->slug);
    }

    public function show(string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        if ($paste->isExpired()) {
            $paste->delete();
            abort(404, 'This paste has expired.');
        }

        // Private pastes only viewable by owner
        if ($paste->visibility === 'private' && auth()->id() !== $paste->user_id) {
            abort(403, 'This paste is private.');
        }

        // If password protected, check session
        if ($paste->isPasswordProtected()) {
            $sessionKey = "paste_unlocked_{$paste->slug}";
            if (!session($sessionKey)) {
                return Inertia::render('PastePassword', [
                    'slug' => $paste->slug,
                    'title' => $paste->title,
                ]);
            }
        }

        // Handle burn after read
        $isBurned = false;
        if ($paste->burn_after_read && $paste->views > 0 && auth()->id() !== $paste->user_id) {
            $paste->delete();
            abort(404, 'This paste has been burned after reading.');
        }

        // Increment views
        $paste->increment('views');

        return Inertia::render('PasteView', [
            'paste' => [
                'slug' => $paste->slug,
                'title' => $paste->title,
                'content' => $paste->content,
                'language' => $paste->language,
                'visibility' => $paste->visibility,
                'burn_after_read' => $paste->burn_after_read,
                'views' => $paste->views,
                'expires_at' => $paste->expires_at?->toISOString(),
                'created_at' => $paste->created_at->toISOString(),
                'is_owner' => auth()->check() && auth()->id() === $paste->user_id,
                'author' => $paste->user?->name,
                'is_password_protected' => $paste->isPasswordProtected(),
            ],
        ]);
    }

    public function verifyPassword(Request $request, string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        $request->validate(['password' => 'required|string']);

        if (!Hash::check($request->password, $paste->password)) {
            return back()->withErrors(['password' => 'Incorrect password.']);
        }

        session(["paste_unlocked_{$paste->slug}" => true]);

        return redirect()->route('paste.show', $paste->slug);
    }

    public function showRaw(string $slug)
    {
        $paste = Paste::where('slug', $slug)->active()->firstOrFail();

        if ($paste->visibility === 'private' && auth()->id() !== $paste->user_id) {
            abort(403);
        }

        if ($paste->isPasswordProtected() && !session("paste_unlocked_{$paste->slug}")) {
            abort(403, 'Password required.');
        }

        return response($paste->content, 200)->header('Content-Type', 'text/plain');
    }

    public function destroy(string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        if (auth()->id() !== $paste->user_id && !(auth()->user()?->isAdmin())) {
            abort(403);
        }

        $paste->delete();

        return redirect()->route('home')->with('success', 'Paste deleted.');
    }

    private function generateUniqueSlug(): string
    {
        do {
            $slug = Str::random(16);
        } while (Paste::where('slug', $slug)->exists());

        return $slug;
    }
}
