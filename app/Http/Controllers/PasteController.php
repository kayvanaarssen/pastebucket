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
            'expiry_hours' => "nullable|numeric|min:0|max:{$maxExpiry}",
            'burn_after_read' => 'boolean',
            ...self::encryptionRules(),
        ]);

        // Only logged-in users can create private pastes
        if ($validated['visibility'] === 'private' && !auth()->check()) {
            $validated['visibility'] = 'unlisted';
        }

        // Only logged-in users can create non-expiring pastes
        if (empty($validated['expiry_hours']) && !auth()->check()) {
            $validated['expiry_hours'] = config('pastebucket.default_expiry_hours', 24);
        }

        $slug = $this->generateUniqueSlug();

        $isEncrypted = ($validated['encryption_version'] ?? null) !== null;

        $paste = Paste::create([
            'slug' => $slug,
            'user_id' => auth()->id(),
            'title' => $validated['title'],
            'content' => $validated['content'],
            'encryption_version' => $validated['encryption_version'] ?? null,
            'encryption_meta' => $validated['encryption_meta'] ?? null,
            'language' => $validated['language'],
            // An encrypted paste's password never leaves the browser -- it only
            // unwraps the content key there. Storing a hash of it would leak an
            // offline-crackable verifier for the key, so we store nothing.
            'password' => !$isEncrypted && $validated['password']
                ? Hash::make($validated['password'])
                : null,
            'visibility' => $validated['visibility'],
            'expires_at' => $validated['expiry_hours'] ? now()->addHours($validated['expiry_hours']) : null,
            'burn_after_read' => $validated['burn_after_read'] ?? false,
            'ip_address' => $request->ip(),
        ]);

        // Mark this session as the creator so burn-after-read doesn't fire on their first view
        session(["paste_creator_{$paste->slug}" => true]);

        return redirect()->route('paste.show', $paste->slug)->with('just_created', true);
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

        // Legacy plaintext pastes still need the server-side password gate. For
        // encrypted pastes the ciphertext is the gate -- the server has no
        // password to check, and the unlock happens in the browser.
        if (!$paste->isEncrypted() && $paste->isPasswordProtected()) {
            $sessionKey = "paste_unlocked_{$paste->slug}";
            if (!session($sessionKey)) {
                return Inertia::render('PastePassword', [
                    'slug' => $paste->slug,
                    'title' => $paste->title,
                ]);
            }
        }

        // Determine if the viewer is the owner (authenticated owner or anonymous creator via session)
        $isOwner = (auth()->check() && auth()->id() === $paste->user_id)
            || session("paste_creator_{$paste->slug}", false);

        // Increment views
        $paste->increment('views');

        $response = Inertia::render('PasteView', [
            'paste' => [
                'slug' => $paste->slug,
                'title' => $paste->title,
                'content' => $paste->content,
                'encryption_version' => $paste->encryption_version,
                'encryption_meta' => $paste->encryption_meta,
                'is_encrypted' => $paste->isEncrypted(),
                'language' => $paste->language,
                'visibility' => $paste->visibility,
                'burn_after_read' => $paste->burn_after_read,
                'views' => $paste->views,
                'expires_at' => $paste->expires_at?->toISOString(),
                'created_at' => $paste->created_at->toISOString(),
                'is_owner' => $isOwner,
                'author' => $paste->user?->name,
                'is_password_protected' => $paste->isPasswordProtected(),
            ],
        ]);

        // Burn after read. A legacy paste is readable the moment it is sent, so
        // deleting here is safe. An encrypted paste is not readable until the
        // browser decrypts it, and a viewer arriving without a key would destroy
        // content nobody ever read -- so those wait for an explicit burn ACK.
        if ($paste->burn_after_read && !$isOwner && !$paste->isEncrypted()) {
            $paste->delete();
        }

        return $response;
    }

    /**
     * Burn a paste once the viewer confirms they decrypted it.
     *
     * Encrypted burn-after-read pastes cannot be destroyed at render time: the
     * server does not know whether the viewer held a usable key. The browser
     * calls this after a successful decrypt instead.
     */
    public function burn(string $slug)
    {
        $paste = Paste::where('slug', $slug)->first();

        // Already burned by a concurrent read -- the desired end state either way.
        if (!$paste) {
            return response()->noContent();
        }

        // Only ever destroys pastes that opted into burning, so this cannot be
        // turned into a delete primitive for arbitrary pastes.
        if (!$paste->burn_after_read || !$paste->isEncrypted()) {
            abort(403);
        }

        if ($paste->visibility === 'private' && auth()->id() !== $paste->user_id) {
            abort(403);
        }

        $isOwner = (auth()->check() && auth()->id() === $paste->user_id)
            || session("paste_creator_{$paste->slug}", false);

        if (!$isOwner) {
            $paste->delete();
        }

        return response()->noContent();
    }

    public function verifyPassword(Request $request, string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        // Encrypted pastes unlock in the browser; there is no server-side secret
        // to verify and no session gate to set.
        if ($paste->isEncrypted()) {
            abort(404);
        }

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

        // An encrypted paste has no server-readable plaintext to serve, so /raw
        // becomes a browser page that decrypts with the key from the fragment.
        // This is the one capability E2E genuinely costs: it is no longer
        // fetchable with curl, because the key never reaches the server.
        if ($paste->isEncrypted()) {
            return Inertia::render('PasteRaw', [
                'paste' => [
                    'slug' => $paste->slug,
                    'title' => $paste->title,
                    'content' => $paste->content,
                    'encryption_version' => $paste->encryption_version,
                    'encryption_meta' => $paste->encryption_meta,
                    'is_password_protected' => $paste->isPasswordProtected(),
                ],
            ]);
        }

        if ($paste->isPasswordProtected() && !session("paste_unlocked_{$paste->slug}")) {
            abort(403, 'Password required.');
        }

        return response($paste->content, 200)->header('Content-Type', 'text/plain');
    }

    public function edit(string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        if (auth()->id() !== $paste->user_id) {
            abort(403, 'You can only edit your own pastes.');
        }

        if ($paste->isExpired()) {
            $paste->delete();
            abort(404, 'This paste has expired.');
        }

        $maxExpiry = config('pastebucket.user_max_expiry_hours');

        // Calculate remaining hours until expiry (or 0 for never)
        $currentExpiryHours = 0;
        if ($paste->expires_at) {
            $remainingHours = max(0, now()->diffInHours($paste->expires_at, false));
            $currentExpiryHours = (int) round($remainingHours);
        }

        return Inertia::render('PasteEdit', [
            'paste' => [
                'slug' => $paste->slug,
                'title' => $paste->title,
                'content' => $paste->content,
                'encryption_version' => $paste->encryption_version,
                'encryption_meta' => $paste->encryption_meta,
                'is_encrypted' => $paste->isEncrypted(),
                'language' => $paste->language,
                'visibility' => $paste->visibility,
                'burn_after_read' => $paste->burn_after_read,
                'expires_at' => $paste->expires_at?->toISOString(),
                'is_password_protected' => $paste->isPasswordProtected(),
            ],
            'maxExpiry' => $maxExpiry,
            'currentExpiryHours' => $currentExpiryHours,
        ]);
    }

    public function update(Request $request, string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        if (auth()->id() !== $paste->user_id) {
            abort(403, 'You can only edit your own pastes.');
        }

        if ($paste->isExpired()) {
            $paste->delete();
            abort(404, 'This paste has expired.');
        }

        $maxExpiry = config('pastebucket.user_max_expiry_hours');

        $validated = $request->validate([
            'title' => 'nullable|string|max:255',
            'content' => 'required|string',
            'language' => 'nullable|string|max:50',
            'password' => 'nullable|string|min:1',
            'remove_password' => 'boolean',
            'visibility' => 'required|in:public,unlisted,private',
            'expiry_hours' => "nullable|numeric|min:0|max:{$maxExpiry}",
            'burn_after_read' => 'boolean',
            ...self::encryptionRules(),
        ]);

        $isEncrypted = ($validated['encryption_version'] ?? null) !== null;

        $updateData = [
            'title' => $validated['title'],
            'content' => $validated['content'],
            'encryption_version' => $validated['encryption_version'] ?? null,
            'encryption_meta' => $validated['encryption_meta'] ?? null,
            'language' => $validated['language'],
            'visibility' => $validated['visibility'],
            'burn_after_read' => $validated['burn_after_read'] ?? false,
        ];

        // Handle expiry: recalculate from now
        if (isset($validated['expiry_hours']) && $validated['expiry_hours'] > 0) {
            $updateData['expires_at'] = now()->addHours($validated['expiry_hours']);
        } elseif (isset($validated['expiry_hours']) && $validated['expiry_hours'] == 0) {
            $updateData['expires_at'] = null; // Never expire
        }

        // Handle password changes. An encrypted paste carries its password in the
        // key wrapping the browser just rebuilt, so the column stays null.
        if ($isEncrypted) {
            $updateData['password'] = null;
        } elseif (!empty($validated['remove_password']) && $validated['remove_password']) {
            $updateData['password'] = null;
        } elseif (!empty($validated['password'])) {
            $updateData['password'] = Hash::make($validated['password']);
        }

        $paste->update($updateData);

        return redirect()->route('paste.show', $paste->slug)->with('success', 'Paste updated.');
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

    /**
     * Validation for the client-supplied encryption envelope.
     *
     * These are the non-secret parameters needed to decrypt. The content key is
     * absent by design: it lives in the URL fragment or is wrapped under the
     * user's password, and either way the server must never be able to derive it.
     *
     * @return array<string, string>
     */
    private static function encryptionRules(): array
    {
        return [
            'encryption_version' => 'nullable|integer|in:1',
            'encryption_meta' => 'nullable|array|required_with:encryption_version',
            'encryption_meta.mode' => 'required_with:encryption_meta|in:fragment,password',
            'encryption_meta.iv' => 'required_with:encryption_meta|string|max:64',
            'encryption_meta.salt' => 'nullable|string|max:64',
            'encryption_meta.iterations' => 'nullable|integer|min:100000|max:10000000',
            'encryption_meta.wrapped_key' => 'nullable|string|max:256',
            'encryption_meta.wrap_iv' => 'nullable|string|max:64',
        ];
    }

    private function generateUniqueSlug(): string
    {
        do {
            $slug = Str::random(16);
        } while (Paste::where('slug', $slug)->exists());

        return $slug;
    }
}
