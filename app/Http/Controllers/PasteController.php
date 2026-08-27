<?php

namespace App\Http\Controllers;

use App\Models\Paste;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;

class PasteController extends Controller
{
    /**
     * Alphabet for short codes, matching the one Shortlinker uses.
     *
     * Drops every glyph pair that goes wrong when a code is read aloud or copied
     * off a screen: 0/O/o, 1/l/I, and f (heard as "s"). What is left is 52
     * characters, so six of them is a shade under 2^34 -- unguessable enough
     * for a rate-limited lookup, short enough to dictate over the phone.
     */
    private const SHORT_CODE_ALPHABET = 'abcdegjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

    private const SHORT_CODE_LENGTH = 6;

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
        return $this->renderPaste(Paste::where('slug', $slug)->firstOrFail());
    }

    /**
     * Look a short code up by its HMAC.
     *
     * The code itself is never stored. It is the password that unwraps the
     * content key, so keeping it beside the wrapped key would put both halves in
     * the same database dump. The HMAC is keyed on APP_KEY, which lives in the
     * environment rather than the database -- enough to resolve a paste, useless
     * to someone holding only a copy of the table.
     */
    private static function hashShortCode(string $code): string
    {
        return hash_hmac('sha256', $code, config('app.key'));
    }

    /**
     * Resolve a paste from its short code.
     *
     * The paste renders in place rather than redirecting to /p/{slug}. A
     * redirect would work -- browsers reattach the fragment when the target has
     * none -- but it would swap the short URL in the address bar for the long
     * one, which defeats the point of having typed the short one.
     */
    public function showByShortCode(string $code)
    {
        $paste = Paste::where('short_code_hash', self::hashShortCode($code))->firstOrFail();

        return $this->renderPaste($paste, viaShortCode: true);
    }

    /**
     * Mint a short code for a paste, or hand back the one it already has.
     *
     * Owner-only. A short code is a second, much shorter address for the paste,
     * so letting any viewer mint one would let a stranger downgrade someone
     * else's 16-character slug to a 6-character handle.
     */
    public function createShortLink(Request $request, string $slug)
    {
        $paste = Paste::where('slug', $slug)->firstOrFail();

        if ($paste->isExpired()) {
            $paste->delete();
            abort(404, 'This paste has expired.');
        }

        if (!$paste->isOwnedByViewer()) {
            abort(403, 'Only the paste owner can create a short link.');
        }

        $validated = $request->validate([
            // Generated in the browser, because for an encrypted paste it is the
            // password that wraps the content key -- the server only ever sees
            // it in order to hash it, and stores the hash.
            'short_code' => ['required', 'string', 'size:'.self::SHORT_CODE_LENGTH, 'regex:/^['.self::SHORT_CODE_ALPHABET.']+$/'],
            // Absent for password-mode and legacy pastes: those have nothing to
            // wrap, so their short code is a plain alias.
            'short_meta' => 'nullable|array',
            'short_meta.salt' => 'required_with:short_meta|string|max:64',
            'short_meta.iterations' => 'required_with:short_meta|integer|min:100000|max:10000000',
            'short_meta.wrapped_key' => 'required_with:short_meta|string|max:256',
            'short_meta.wrap_iv' => 'required_with:short_meta|string|max:64',
        ]);

        $hash = self::hashShortCode($validated['short_code']);

        // A collision means someone else's paste already answers to this code.
        // The browser holds the only copy of it, so it has to mint another.
        if (Paste::where('short_code_hash', $hash)->where('id', '!=', $paste->id)->exists()) {
            return response()->json(['message' => 'That code is taken.'], 409);
        }

        // Overwrites any previous code. The old one cannot be recovered to be
        // kept alive -- only its hash was ever stored -- so it stops working,
        // which the UI says before the owner presses the button.
        $paste->update([
            'short_code_hash' => $hash,
            'short_meta' => $validated['short_meta'] ?? null,
        ]);

        return response()->json([
            'short_url' => url('/s/'.$validated['short_code']),
        ]);
    }

    /**
     * Render a paste that has already been resolved, whichever address it
     * arrived by. Everything here is keyed off the paste, not the URL.
     */
    private function renderPaste(Paste $paste, bool $viaShortCode = false)
    {
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
        $isOwner = $paste->isOwnedByViewer();

        // Increment views
        $paste->increment('views');

        $response = Inertia::render('PasteView', [
            'paste' => [
                'slug' => $paste->slug,
                // Whether one exists -- never which. The code is unrecoverable
                // from its hash, so the owner copies it at mint time or re-mints.
                'has_short_link' => $paste->short_code_hash !== null,
                // The wrapping parameters go only to a viewer who already
                // presented a code. Serving them on /p/{slug} would hand anyone
                // holding the slug the material to brute-force a 2^34 code
                // offline, which is the one thing the short link cannot afford.
                'short_meta' => $viaShortCode ? $paste->short_meta : null,
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

        if (!$paste->isOwnedByViewer()) {
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
