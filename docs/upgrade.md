# Upgrading the hosted instance (Ploi)

This covers deploying the formatted editor, the integration API and the MCP
client to an existing PasteBucket site, such as `https://paste.ictwebsolution.nl`.

The MCP server and CLI run on the users' own machines. **Nothing extra runs on
the server.**

## 1. Before deploying

1. **Take a database backup** (Ploi → Database → Backups, or `mysqldump`).
2. **Confirm the PHP limits** in Ploi → Server → PHP → Settings, or with
   `php -i | grep post_max_size`:
   - `post_max_size` must be at least **8M** for the default 5 MiB API limit
     (see [integrations.md §3](integrations.md#3-payload-limits)).
   - If you raise `PASTE_API_MAX_CONTENT_BYTES`, raise this to about 4/3 of it
     plus 1 MB.
3. **Confirm the nginx body limit**: `client_max_body_size` must be at least
   **8m** (Ploi → Site → Manage → NGINX configuration).
   - nginx's built-in default is 1m.
   - Without this, publishes above roughly 750 KB fail with nginx's own `413`.
     Nothing is truncated; the client reports the error.
4. **Confirm the scheduler** is installed (Ploi → Server → Cronjobs):

   ```
   * * * * * php /home/ploi/paste.ictwebsolution.nl/artisan schedule:run
   ```

   On the server, `php artisan schedule:list` must show:
   - `registration:check` (every minute)
   - `pastes:clean` (hourly)
   - `sanctum:prune-expired --hours=24` (daily)

   If the cronjob is missing, add it. Expired and revoked links are refused
   either way, but rows are only cleaned up by the scheduler.

5. **Only for the ChatGPT connection:** after the first deploy that includes
   Passport, create the OAuth signing keys once on the server with
   `php artisan passport:keys`. They land in `storage/`, which persists
   between deploys. Do not regenerate them on every deploy, or every connected
   app has to reconnect. Full steps: [chatgpt.md](chatgpt.md).

## 2. Environment (optional)

All new settings have safe defaults. Add them to `.env` only to change a default.

```env
PASTE_API_DEFAULT_EXPIRY_HOURS=168     # integration publishes; the website default is unchanged
PASTE_API_MAX_CONTENT_BYTES=5242880    # plaintext bytes; keep post_max_size/client_max_body_size in step
PASTE_API_PUBLISH_PER_MINUTE=20
PASTE_API_REQUESTS_PER_MINUTE=120
PASTE_API_TOKEN_MAX_DAYS=365
PASTE_API_REVOKED_RETENTION_DAYS=30
MCP_REDIRECT_DOMAINS=https://chatgpt.com/  # OAuth redirect targets allowed to register (ChatGPT only by default)
```

No Sanctum stateful-domain configuration is needed. The API accepts tokens
only.

## 3. Deploy

The existing deploy script covers everything:

- `composer install` installs `laravel/sanctum`.
- `npm ci && npm run build` builds the editor.
- `php artisan migrate --force` runs three **additive** migrations:
  - `personal_access_tokens` (new table)
  - `pastes.content_format` (default `code`), `pastes.revoked_at`,
    `pastes.created_via` (default `web`), and an index on `pastes.expires_at`
  - `paste_idempotency_keys` (new table)

On MySQL 8 the new columns are metadata-only changes. The index is built
online. Existing paste contents are not read or rewritten.

Keep `php artisan config:cache` and `route:cache` in the script: `routes/api.php`
is new.

## 4. Verify after deploying

1. Open an existing paste, both code and legacy Markdown. It must look exactly
   as before.
2. On the home page, the *Code / plain text* editor is still the default.
   Switch to *Formatted text*, create a document, open its link in a private
   window, and edit it again.
3. Create a token under **Profile → API Tokens** with an expiry of 7 days, then:

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
     https://paste.ictwebsolution.nl/api/v1/limits
   ```

4. On a workstation, build `mcp/` and publish fictitious content:

   ```bash
   printf '# Test\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' > /tmp/pb-test.md
   PASTEBUCKET_URL=https://paste.ictwebsolution.nl PASTEBUCKET_API_TOKEN=$TOKEN \
     node mcp/dist/mcp/src/cli.js publish /tmp/pb-test.md --expires-hours 1
   ```

   Open the link in a private window. Then run `… cli.js revoke <slug>` and
   reload: the page must say the link was withdrawn.
5. Check that `curl -sI https://paste.ictwebsolution.nl/p/<slug>` shows
   `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
6. Delete the test token.

## 5. Rolling back

The previous release runs against the new schema, since every change is
additive. Before rolling the code back:

- **Revoked pastes.** The old code does not know `revoked_at` and would show
  them as broken pastes. Remove them first:
  `DELETE FROM pastes WHERE revoked_at IS NOT NULL;`
- **API tokens** stop working, because the routes are gone. Their rows are
  harmless.
- **Documents** created with the formatted editor stay readable in the old code
  view: they are Markdown with `language = markdown`.

Only if the schema itself must go: `php artisan migrate:rollback --step=3`.
This drops the tokens, idempotency records and the three `pastes` columns.
