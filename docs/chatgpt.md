# Connecting ChatGPT (remote MCP)

PasteBucket exposes a hosted MCP endpoint at **`/mcp`**. ChatGPT (developer mode)
and other OAuth-capable MCP clients connect to it with OAuth 2.1. It offers the
same three tools as the local server in [`mcp/`](../mcp/README.md):

- `publish_output`
- `get_output_status`
- `revoke_output`

## What is different from the local route (read this first)

| | Website, CLI, local MCP | ChatGPT via `/mcp` |
|---|---|---|
| Where the content is encrypted | on your device | **on the PasteBucket server** |
| Does the server see plaintext? | never | yes, while publishing |
| Does the server see the link key? | never | yes, while publishing |
| What is stored | ciphertext only | ciphertext only |
| Authentication | Sanctum personal token | OAuth 2.1 (Passport), approved by you |

**What happens to a publish over `/mcp`:**

1. ChatGPT sends the document as plaintext.
2. The server encrypts it immediately with the same scheme as
   `resources/js/lib/crypto-core.ts` (AES-256-GCM, fragment key or password
   wrapping), in `app/Support/ServerSideEncryption.php`.
3. It stores only the ciphertext and returns the link, including `#k=<key>`,
   to ChatGPT.

**What is not kept or logged:** the plaintext, the key and any password are
never written to the database, the session or the logs. A test publishes
through a failing server and asserts none of them appear in logs or error
responses.

**What you still have to trust:**
- the server process at the moment of publishing (plaintext and key live in
  PHP memory for that one request);
- OpenAI, which already has the content in the conversation;
- anyone who can alter the server code.

**Where the old guarantees still hold:** this route never weakens pastes
created any other way. If a document must never reach the server
unencrypted, publish it from the website or the local CLI instead.

The consent screen and the *Connected Apps* card on the profile page both say
this in plain words.

## Server setup (once)

1. **Deploy** as usual: `composer install` brings `laravel/passport` and
   `laravel/mcp`, and `php artisan migrate --force` creates the `oauth_*`
   tables.
2. **Create the Passport signing keys** on the server, once:

   ```bash
   php artisan passport:keys
   ```

   This writes `storage/oauth-private.key` and `storage/oauth-public.key`
   (git-ignored).
   - Keep them across deploys; Ploi's `storage` directory persists.
   - Alternatively put them in the environment as `PASSPORT_PRIVATE_KEY` /
     `PASSPORT_PUBLIC_KEY`.
   - Regenerating them invalidates every issued token, so ChatGPT will have to
     reconnect.
3. **Optional `.env` settings:**

   ```env
   # Which OAuth redirect targets may register as a client. Default: ChatGPT only.
   MCP_REDIRECT_DOMAINS=https://chatgpt.com/
   ```

   Dynamic client registration (`POST /oauth/register`) is open by design;
   anyone can register. The redirect allow-list is what limits who can receive
   an approval, and registration is rate limited to 10 per minute per IP.
4. **Scheduler (optional):** Passport tokens expire on their own (access
   tokens after 1 hour, refresh tokens after 30 days). To prune old rows, add
   `php artisan passport:purge` to the schedule.
5. **Check:**

   ```bash
   curl -s https://paste.ictwebsolution.nl/.well-known/oauth-protected-resource/mcp
   curl -s https://paste.ictwebsolution.nl/.well-known/oauth-authorization-server
   ```

   Both must return JSON that points at `https://paste.ictwebsolution.nl`.

## Connecting ChatGPT

Requires a ChatGPT plan and workspace where developer mode is allowed.

1. In ChatGPT: **Settings → Security and login → Developer mode** → on.
2. **Settings → Apps (Plugins) → +** (create) and enter:
   - Name: `PasteBucket`
   - MCP server URL: `https://paste.ictwebsolution.nl/mcp`
   - Authentication: **OAuth** (leave client ID and secret empty; ChatGPT
     registers itself)
3. ChatGPT opens PasteBucket.
   - Log in if needed.
   - The consent screen shows the signed-in account and **where the approval
     is sent** (`chatgpt.com`).
   - Click **Connect**.
4. In a chat, enable the PasteBucket app from the composer's developer-mode tools.

### Usage

> Publiceer dit volledige antwoord in Pastebucket, zeven dagen geldig.

ChatGPT calls `publish_output` with the answer as Markdown and
`expires_in_days: 7`. It gets back:

- the link, including `#k=…`
- the exact expiry in UTC
- confirmation that nothing was sent to anyone

ChatGPT asks for confirmation before running write tools in developer mode.

- **Status:** "Wat is de status van publicatie *slug*?" (`get_output_status`)
- **Revoke:** "Trek publicatie *slug* in." (`revoke_output`)
- **Password:** "…met wachtwoord …". The password is at least 8 characters, and
  the link then carries no key.

**Whole conversations:** ChatGPT only has what is in its context, and it has
to write the full text out again as the tool argument. For long transcripts,
export the conversation and use the website or the local CLI instead.

### Disconnecting

**Profile → Connected Apps → Disconnect** revokes the app's access and refresh
tokens immediately: the next MCP call fails. Pastes it already published stay
online until they expire; revoke them separately if needed.

## Limits and defaults

These are the same as the token API (see [integrations.md](integrations.md)):

- unlisted Markdown document
- 7 days by default, at most the account's maximum expiry
- not burn-after-read
- `PASTE_API_MAX_CONTENT_BYTES` (default 5 MiB)
- 120 MCP requests per minute per user

Content over the limit is refused, never truncated.

## Troubleshooting

| Symptom | Cause |
|---|---|
| ChatGPT reports `invalid_redirect_uri` | its redirect host is not in `MCP_REDIRECT_DOMAINS` |
| ChatGPT keeps asking to reconnect | Passport keys were regenerated, or the app was disconnected on the profile page |
| `401` on `/mcp` with a valid connection | the access token expired and the refresh token was revoked; reconnect |
| Publish refused as too large | raise `PASTE_API_MAX_CONTENT_BYTES` together with PHP `post_max_size` and nginx `client_max_body_size` |
