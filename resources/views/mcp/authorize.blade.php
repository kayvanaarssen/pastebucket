<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Connect {{ $client->name }} - {{ config('app.name', 'PasteBucket') }}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=inter:400,500,600,700" rel="stylesheet" />
    {{-- Same theme bootstrap as the app layout, so this page matches it. --}}
    <script>
        (function () {
            const theme = localStorage.getItem('theme');
            if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
            }
        })();
    </script>
    @vite(['resources/css/app.css'])
</head>
@php
    // Anyone can register a client and call it "ChatGPT". What cannot be faked
    // is where the approval is sent, so that is shown instead of a logo the
    // client supplied (which would also load a third-party image here).
    $redirectHosts = collect($client->redirect_uris ?? [])
        ->map(fn ($uri) => parse_url($uri, PHP_URL_HOST))
        ->filter()
        ->unique()
        ->values();
@endphp
<body class="font-sans antialiased bg-background text-foreground">
<div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="space-y-2 p-6 text-center">
            <p class="text-sm font-semibold text-primary">{{ config('app.name', 'PasteBucket') }}</p>
            <h1 class="text-2xl font-semibold tracking-tight">Connect {{ $client->name }}?</h1>
            <p class="text-sm text-muted-foreground">
                This lets an assistant publish documents to your account as expiring customer links.
            </p>
        </div>

        <div class="space-y-4 px-6">
            <div class="rounded-lg border bg-muted/50 p-4 text-sm">
                <p class="text-muted-foreground">Signed in as</p>
                <p class="font-medium">{{ $user->email }}</p>
                @if ($redirectHosts->isNotEmpty())
                    <p class="mt-3 text-muted-foreground">You will be returned to</p>
                    <p class="font-medium">{{ $redirectHosts->implode(', ') }}</p>
                @endif
            </div>

            <div class="space-y-2 text-sm">
                <p class="font-medium">It will be able to:</p>
                <ul class="list-disc space-y-1 pl-5 text-muted-foreground">
                    <li>publish documents you ask it to publish</li>
                    <li>check the status and expiry of your pastes</li>
                    <li>revoke your pastes</li>
                </ul>
            </div>

            <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                Documents published this way reach the PasteBucket server as plain text and are encrypted there
                before they are stored. Pastes created on the website or with the local CLI never leave your device
                unencrypted.
            </div>

            <p class="text-xs text-muted-foreground">
                You can disconnect it at any time under Profile &rarr; Connected apps.
            </p>
        </div>

        <div class="flex gap-3 p-6">
            <form method="POST" action="{{ route('passport.authorizations.deny') }}" class="flex-1">
                @csrf
                @method('DELETE')
                <input type="hidden" name="state" value="">
                <input type="hidden" name="client_id" value="{{ $client->id }}">
                <input type="hidden" name="auth_token" value="{{ $authToken }}">
                <button type="submit" class="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                    Cancel
                </button>
            </form>
            <form method="POST" action="{{ route('passport.authorizations.approve') }}" class="flex-1">
                @csrf
                <input type="hidden" name="state" value="">
                <input type="hidden" name="client_id" value="{{ $client->id }}">
                <input type="hidden" name="auth_token" value="{{ $authToken }}">
                <button type="submit" class="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Connect
                </button>
            </form>
        </div>
    </div>
</div>
</body>
</html>
