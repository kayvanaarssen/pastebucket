# Integrations: formatted documents, the API and the MCP client

This document covers what was added on top of the existing paste app:

- the formatted-text editor and document view,
- the versioned JSON API with personal access tokens,
- the local MCP server and CLI in [`mcp/`](../mcp/README.md),

and the rules they share for content formats, payload limits, encryption,
metadata, expiry, revocation and backups.

---

## 1. Content formats

Every paste now stores its format explicitly in `pastes.content_format`. The
`language` column still exists, but it only ever described syntax highlighting
and is no longer used to decide how a paste is read.

| `content_format` | Stored content | Customer view | Edited with |
|---|---|---|---|
| `code` | the text exactly as typed | the existing code view, highlighted by `language` (a `markdown` language keeps its Source/Formatted toggle) | the existing code/plain-text editor |
| `markdown` | GitHub-flavoured Markdown | a calm, readable document (with a Source toggle) | the visual editor, or the Markdown source |

- **The website default is unchanged:** the code editor, `content_format=code`.
  Only choosing *Formatted text* creates a `markdown` document.
- **Integration publishes default to `markdown`.**
- **Existing pastes are untouched.** The migration adds the column with default
  `code`, which is what every existing paste already is. No encrypted content is
  read, converted or rewritten server-side.

### Why rich text is stored as Markdown

The visual editor offers headings, bold, italic, strikethrough, bullet and
numbered lists, checklists, links, quotes, tables, inline code and code blocks.
All of these have an exact GitHub-flavoured Markdown representation. So the
simplest format that preserves every offered feature is Markdown itself. There is
no separate document format, and no derived editor representation is stored.

Consequences:

- Markdown published through the API or CLI is stored **byte for byte** and
  shown as-is. Nothing is normalised on the way in.
- Opening a document in the visual editor and saving it *without changes*
  keeps the original Markdown string.
- Saving *after* editing re-serialises the document. The meaning is kept, but
  cosmetic source details (list markers, table padding) may be normalised.
- The editor parses Markdown with the same parser family as the customer view
  (remark + GFM), so the editor shows what the customer will see.

### Conversions never lose data silently

Some Markdown has no visual-editor equivalent:

- raw HTML
- images
- footnotes
- numbered checklists
- line breaks or lists inside table cells

These are detected *before* anything changes:

- **Opening such a document for editing** starts in the Markdown source editor
  and lists what the visual editor would not keep.
- **Switching editors** (code ↔ formatted) shows the list of affected parts
  and offers *Cancel*. Code in a programming language can be moved into a
  code block, which is lossless, instead of being interpreted as Markdown.
- **The pre-conversion original is kept** in the page, with a *Restore original*
  action, until the paste is saved.
- **Saving a visual document that Markdown cannot represent exactly** asks for
  confirmation first.

### Pasting and importing

- **Pasted formatted text** (ChatGPT, Claude, Word, Google Docs) keeps its
  supported formatting.
- **Removed on paste:** scripts, styles, event handlers, embeds and unsupported
  markup.
- **Word lists** are rebuilt as real lists.
- **Images and file attachments are not supported in this version.** They are
  neither loaded nor uploaded; the editor says how many were left out.
- **Markdown import** is explicit (*Import Markdown*: paste text or pick a `.md`
  file) and shows any unsupported parts before importing.
- Pasted or imported text is treated purely as content, never as an
  instruction to the app.

### Customer view safety

Documents render through `react-markdown` without raw HTML:

- HTML in a document is shown as text.
- Link URLs with unsafe schemes (`javascript:`, `data:`, …) are dropped.
- Links open in a new tab with `noopener noreferrer`.
- Remote images in a document are **not loaded** and are shown as a link
  instead, so opening a document never contacts a third party.
- Paste pages send `Referrer-Policy: no-referrer`.

---

## 2. The API (`/api/v1`)

All endpoints require `Authorization: Bearer <token>` and answer JSON (also on
errors). Browser sessions are **not** accepted: Sanctum's session guard is
disabled (`config/sanctum.php` → `guard: []`), so there is no cookie or CSRF path
into the API. The browser routes keep their CSRF protection.

### Tokens

Tokens are managed on **Profile → API Tokens**.

- Each token has a name, abilities and an expiry of 7, 30, 90, 180 or 365 days,
  capped by `PASTE_API_TOKEN_MAX_DAYS`.
- The token is shown **once**, in the response to the create call. It is never
  flashed through the session.
- Only a SHA-256 hash is stored (Sanctum `personal_access_tokens`).
- Revoking a token makes its next call fail with `401`.
- Expired tokens are rejected immediately and pruned daily
  (`sanctum:prune-expired`).

| Ability | Allows |
|---|---|
| `pastes:create` | `POST /api/v1/pastes` |
| `pastes:read` | `GET /api/v1/pastes/{slug}` |
| `pastes:revoke` | `DELETE /api/v1/pastes/{slug}` |

`GET /api/v1/limits` needs any valid token. Status and revoke additionally
require that the token's user **owns** the paste. Someone else's paste answers
`404`, exactly like a missing one.

### `GET /api/v1/limits`

```json
{"data":{"max_content_bytes":5242880,"default_expiry_hours":168,"max_expiry_hours":8760,
 "min_expiry_hours":1,"content_formats":["code","markdown"],"encryption_versions":[1]}}
```

### `POST /api/v1/pastes`

Headers: `Idempotency-Key: <1–100 of A-Z a-z 0-9 _ . : ->` (optional, recommended).

| Field | Default | Notes |
|---|---|---|
| `content` | required | base64url AES-GCM ciphertext, produced locally |
| `encryption_version` | required | `1` |
| `encryption_meta` | required | fragment mode: `{"mode":"fragment","iv":…}` only.<br>Password mode: `mode, iv, salt, iterations, wrapped_key, wrap_iv`.<br>Exact base64url lengths are enforced; other keys are rejected. |
| `title` | `null` | **stored unencrypted**; the MCP client sends `Shared document` |
| `content_format` | `markdown` | or `code` |
| `language` | `markdown` / `text` | only meaningful for `code` |
| `visibility` | `unlisted` | `unlisted`, `private` or `public` |
| `expires_in_hours` | `168` | integer `1…max_expiry_hours`. A missing value means 7 days, never unlimited. |
| `burn_after_read` | `false` | |

The fields `password`, `key`, `fragment_key`, `encryption_key` and `plaintext`
are **refused** (`422`) so a client bug cannot quietly hand the server a secret.
Their values are never echoed back.

Response `201`, and the same shape for status and revoke:

```json
{"data":{"slug":"AbCdEfGhIjKlMnOp","url":"https://paste.ictwebsolution.nl/p/AbCdEfGhIjKlMnOp",
 "title":"Shared document","created_at":"2026-09-14T17:04:12.000000Z",
 "expires_at":"2026-09-21T17:04:12.000000Z","content_format":"markdown","language":"markdown",
 "visibility":"unlisted","burn_after_read":false,"encryption_mode":"fragment",
 "status":"active","revoked_at":null}}
```

`url` never contains a key. The client appends `#k=<key>` itself.

**Idempotency.** Each key is scoped to the token's user:

| Repeat request | Response |
|---|---|
| Same key, identical body | `200`, `Idempotent-Replayed: true`, the original paste with its **original `expires_at`** |
| Same key, different body | `409` `idempotency_key_reused` |
| Same key, but the paste was deleted in the meantime | `410` `idempotency_paste_gone` |

- Concurrent duplicates are resolved by a unique index. The second request
  receives the first one's paste.
- Key records expire together with their paste and are removed by
  `pastes:clean`.

### `GET /api/v1/pastes/{slug}`: status

Returns the data shape with `status` = `active`, `expired` or `revoked`.

- `expired` is reported from the exact expiry moment on.
- After the row has been cleaned up, the answer is `404`.

### `DELETE /api/v1/pastes/{slug}`: revoke

- Sets `revoked_at` and wipes the ciphertext, the encryption parameters and any
  short-link wrapping in the same write.
- Idempotent: repeating it answers `200` with `status: revoked`.
- A share link grants no management rights. Only a token with `pastes:revoke`
  whose user owns the paste can revoke it.

### Errors

| Status | When |
|---|---|
| 401 `{"message":"Unauthenticated."}` | missing, malformed, expired or revoked token |
| 403 `missing_ability` | token lacks the ability |
| 404 `Paste not found.` | unknown slug or another user's paste |
| 409 `idempotency_key_reused` | see above |
| 413 `payload_too_large` | content over `max_content_bytes` (includes `content_bytes` and `max_content_bytes`), or a body over PHP's `post_max_size` |
| 422 | validation; Laravel's `{"message","errors":{field:[…]}}` |
| 429 | rate limit, with `Retry-After` |

### Rate limits

| Limit | Default | Setting |
|---|---|---|
| All API calls, per user | 120 per minute | `PASTE_API_REQUESTS_PER_MINUTE` |
| Publishes, per user | 20 per minute | `PASTE_API_PUBLISH_PER_MINUTE` |

---

## 3. Payload limits

`PASTE_API_MAX_CONTENT_BYTES` (default **5 MiB**) limits the **plaintext** size of
an integration publish.

**How it is enforced.** The server never decrypts. The plaintext size follows
exactly from the ciphertext length: base64url without padding of
`plaintext + 16-byte GCM tag`, so `floor(len × 3 / 4) − 16`. The MCP client
checks the same number before it encrypts anything.

**Overhead.** The HTTP body is about `4/3 × plaintext` plus JSON. For the 5 MiB
default a body is at most ≈ 6.7 MiB, so the hosting must allow at least:

| Setting | Minimum for the default |
|---|---|
| PHP `post_max_size` | `8M` |
| nginx `client_max_body_size` | `8m` |

A body larger than `post_max_size` gets a JSON `413` from the app. A body larger
than the nginx limit gets nginx's own `413`, which the client also reports as
too large.

Content is **never truncated**. Too much is refused whole, with both byte
counts.

The website's own routes are unchanged: no application-level limit beyond
PHP/nginx.

---

## 4. Encryption

**Shared implementation.** The browser and the MCP client use one implementation,
[`resources/js/lib/crypto-core.ts`](../resources/js/lib/crypto-core.ts):

- AES-GCM-256 with a random content key per paste.
- Password mode wraps that key under PBKDF2-HMAC-SHA256 with 600,000 iterations.

`crypto.ts` adds only the browser-specific parts (URL fragment, sessionStorage).
There is no new protocol.

**Fragment links by default:**

```
https://paste.ictwebsolution.nl/p/{slug}#k={key}
```

- The MCP client builds this link **locally**. The fragment key, the plaintext and
  the password are never sent to the server, and never logged by the server or
  the client.
- A test publishes with a nearly-right token, secret fields and a mid-request
  server failure, then asserts none of these values appear in responses or logs.

**No short links from integrations.** A short link (`/s/{code}`) puts a
6-character secret in the request path, where the server sees it. It is also
far weaker than a 256-bit fragment key. Integrations never mint one. Existing
short links keep working as before (see *Short links and what they cost* in the
README).

**What the server receives and stores:**
- ciphertext
- the IV
- in password mode: salt, iteration count, wrapped key and wrap IV

**Not encrypted (metadata):**
- title (keep it neutral; the MCP default is `Shared document`)
- content format and language
- visibility and the burn-after-read flag
- created, expiry and revoked timestamps
- view count
- owning account, creator IP and `created_via` (`web`/`api`)
- the idempotency key (the client uses random keys)

**Who handles the plaintext.** The protection is about what the PasteBucket
server receives, stores and puts in backups. The local MCP client and the
assistant that calls it (Claude Code, Codex) **do** process the plaintext: the
assistant already has it in its context, and the client has to read it to
encrypt it. Anyone holding the full link can read the document until it expires
or is revoked.

---

## 5. Expiry, revocation, caching and backups

- **Exact boundary.** A paste is unavailable **at** its `expires_at`, not a tick
  after (`expires_at <= now`).
  - The same check guards every content route: `/p/{slug}`, `/s/{code}`,
    `/p/{slug}/raw`, editing and saving, short-link creation, the burn ACK, the
    legacy password check, and the API status.
  - Access never waits for the cleanup job.
- **Expired pastes** are deleted the first time anyone requests them (as
  before), or by the hourly cleanup, whichever comes first. The link shows
  *"This link has expired"* (HTTP 404).
- **Revoked pastes** lose their ciphertext immediately. The link shows *"This
  link has been withdrawn"* (HTTP 410). The content-free row stays so the owner
  can see the status; it is deleted when it expires or after
  `PASTE_API_REVOKED_RETENTION_DAYS` (default 30).
- **Invalid links** show *"This link is not valid"* (HTTP 404).
- **Multiple reads.** Integration publishes are not burn-after-read, so a
  customer can open the link as often as needed until it expires.
- **Caching.** Every paste route, the unavailable page and every API response
  send `Cache-Control: no-store`. Paste pages add `Referrer-Policy: no-referrer`
  and `X-Robots-Tag: noindex, nofollow, noarchive`. Public pastes are the one
  exception to `noindex`.

### Scheduler

`routes/console.php` schedules:

| Command | When | Purpose |
|---|---|---|
| `registration:check` | every minute | closes expired registration windows |
| `pastes:clean` | hourly | deletes expired pastes, long-revoked rows and stale idempotency records |
| `sanctum:prune-expired --hours=24` | daily | removes tokens that expired more than a day ago |

This needs the standard Laravel cron entry:
`* * * * * cd {SITE_DIRECTORY} && php artisan schedule:run >> /dev/null 2>&1`

Check it with `php artisan schedule:list`. If the scheduler is not running,
links still stop working on time: only the database rows linger.

### What expiry and revocation do not undo

- **Backups.** A database backup taken before a paste was deleted still
  contains the row until that backup rotates out.
  - Fragment-mode ciphertext in a backup is useless without the link.
  - A password-mode paste in a leaked backup can be attacked offline, so
    choose strong passwords.
  - Titles and other metadata in backups are readable.
- **Copies.** Expiry and revocation stop the link. They cannot recall anything a
  recipient already copied, downloaded, printed, screenshotted or forwarded
  while it was available.

---

## 6. MCP server and CLI

Installation, Claude Code and Codex configuration, and usage examples (one
answer, a transcript file, password mode, status, revocation, recovery data) are
in [`mcp/README.md`](../mcp/README.md).

Out of scope for this version:
- a publicly hosted MCP server
- integration with browser-based ChatGPT or Claude
- automatic access to chat history
- sending links to customers
