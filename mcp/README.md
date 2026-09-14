# PasteBucket MCP server and CLI

A small local tool that lets Claude Code, Codex (or you, in a terminal) publish
a document to PasteBucket as an end-to-end encrypted, expiring customer link.

- **`pastebucket-mcp`**: an MCP server over stdio with three tools:
  `publish_output`, `get_output_status` and `revoke_output`.
- **`pastebucket`**: a CLI on the same client. It publishes a file byte for byte,
  so a long transcript never has to be retyped by a language model.

Both encrypt on your machine with `resources/js/lib/crypto-core.ts`, the same
module the website uses to decrypt. The API they talk to is documented in
[`docs/integrations.md`](../docs/integrations.md).

## Security model: what is and isn't protected

**What the PasteBucket server receives:** AES-GCM ciphertext, the non-secret
encryption parameters (IV, and in password mode salt, iteration count and the
wrapped key), plus metadata. The server never receives the plaintext, the
fragment key, the password or the finished share link.

**What stays readable (not encrypted):**
- the title
- content format and language
- visibility, burn-after-read flag
- created/expiry/revoked timestamps
- the owning account and the request IP

Keep titles neutral. The default is `Shared document`.

**Who sees the plaintext:** this local client and the assistant calling it.
The assistant already has the text in its context, and the MCP client has to
read it in order to encrypt it. The encryption protects what the PasteBucket
server stores and what its database and backups contain. It does not hide the
content from your assistant, its provider, or this machine.

**Fragment links by default.** The key travels in the URL fragment,
`https://paste.ictwebsolution.nl/p/{slug}#k={key}`. Browsers never send the
fragment to the server. The tool never creates short links: a short link puts a
much smaller secret in the request path, where the server sees it (see "Short
links and what they cost" in the main README). Anyone holding the full link
can read the document until it expires or is revoked.

**Password mode** (optional): the content key is wrapped under PBKDF2(password),
the link carries no key, and the reader types the password. The password is
never sent. Share it through a different channel than the link.

**Nothing is sent to the customer automatically.** The tool returns the link to
you, and you decide who receives it.

## Install

Requires Node.js 22 or newer.

```bash
cd /path/to/pastebucket/mcp
npm ci
npm run build
```

This produces:

- `dist/mcp/src/server.js`: the MCP server
- `dist/mcp/src/cli.js`: the CLI

For the CLI on your PATH, run `npm link` in this directory, or add an alias:
`alias pastebucket="node /path/to/pastebucket/mcp/dist/mcp/src/cli.js"`.

## Create an API token

1. Log in to PasteBucket and open **Profile → API tokens**.
2. Create a token with a recognisable name (e.g. `Claude Code – laptop`).
   - Pick an expiry.
   - Pick the abilities you need:
     - `pastes:create`: publish
     - `pastes:read`: status
     - `pastes:revoke`: revoke
3. Copy the token. It is shown **once** and stored hashed. Revoke it on the same
   page when a machine is lost or the token leaks.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `PASTEBUCKET_URL` | yes | e.g. `https://paste.ictwebsolution.nl`. Must be https; http only for localhost |
| `PASTEBUCKET_API_TOKEN` | yes* | the token from your Profile page |
| `PASTEBUCKET_API_TOKEN_FILE` | yes* | alternative: path to a file holding the token (keeps it out of MCP config files) |
| `PASTEBUCKET_STATE_DIR` | no | recovery data location (default `~/.local/state/pastebucket`, `%LOCALAPPDATA%\pastebucket` on Windows) |

\* One of the two.

### Claude Code

```bash
claude mcp add pastebucket --scope user \
  -e PASTEBUCKET_URL=https://paste.ictwebsolution.nl \
  -e PASTEBUCKET_API_TOKEN_FILE=$HOME/.config/pastebucket/token \
  -- node /path/to/pastebucket/mcp/dist/mcp/src/server.js
```

The equivalent JSON, in `~/.claude.json` (user scope) or in a project `.mcp.json`.
**Do not commit tokens.**

```json
{
  "mcpServers": {
    "pastebucket": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/pastebucket/mcp/dist/mcp/src/server.js"],
      "env": {
        "PASTEBUCKET_URL": "https://paste.ictwebsolution.nl",
        "PASTEBUCKET_API_TOKEN_FILE": "/home/you/.config/pastebucket/token"
      }
    }
  }
}
```

Check it with `claude mcp list`, or `/mcp` inside a session.

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.pastebucket]
command = "node"
args = ["/path/to/pastebucket/mcp/dist/mcp/src/server.js"]

[mcp_servers.pastebucket.env]
PASTEBUCKET_URL = "https://paste.ictwebsolution.nl"
PASTEBUCKET_API_TOKEN_FILE = "/home/you/.config/pastebucket/token"
```

Or the same with the CLI:

```bash
codex mcp add pastebucket \
  --env PASTEBUCKET_URL=https://paste.ictwebsolution.nl \
  --env PASTEBUCKET_API_TOKEN_FILE=$HOME/.config/pastebucket/token \
  -- node /path/to/pastebucket/mcp/dist/mcp/src/server.js
```

## Usage

### One complete answer

Say to Claude Code or Codex:

> Publiceer dit volledige antwoord in Pastebucket, zeven dagen geldig.

The assistant calls `publish_output` with the answer as Markdown, verbatim, and
`expires_in_days: 7` (also the default). It replies with:

- the share link, including `#k=…`
- the exact expiry in UTC, e.g. `2026-09-21T17:04:12.000000Z`
- confirmation that the link was not sent to anyone

The server's instructions tell the assistant:

- Publish only what you point at.
- Never summarise, rewrite or truncate it.
- Never add hidden reasoning or system instructions.
- Say so when the full text is not available to it verbatim, instead of
  reconstructing it.

### A conversation or transcript file (exact)

Long conversations should not be retyped by the model. Publish them from a file
with the CLI.

**Claude Code:** export the conversation, then ask the assistant to run the
CLI on that explicitly named file:

```text
/export conversation.txt
```

> Publiceer conversation.txt met de pastebucket CLI, zeven dagen geldig.

The assistant runs, via its Bash tool:

```bash
pastebucket publish conversation.txt --title "Gesprek" --expires-days 7
```

**Codex:** name the file explicitly, e.g. a transcript you saved or exported:
"publish `./notes/transcript.md` with the pastebucket CLI". Codex runs the same
command.

The CLI reads **only** the path you give (or stdin for `-`):

- It decodes strict UTF-8, refusing invalid bytes instead of replacing them.
- It keeps a leading BOM, CRLF, tabs and trailing whitespace.
- It publishes byte for byte.

Formats:

- `.md`/`.markdown`: published as a formatted document.
- Other files: published as plain text with whitespace preserved.
- Override with `--format markdown|text`.

Neither the assistant nor this tool has automatic access to your ChatGPT or
Claude history. Only explicitly provided text or files are published. If you
ask for "the whole conversation" and the assistant does not have it verbatim,
it should tell you and suggest exporting it to a file.

### Password protection

MCP: ask for a password ("…met wachtwoord"). The assistant passes `password`,
at least 8 characters.

CLI: never put a password on the command line. Use one of:

```bash
PB_PASSWORD='…' pastebucket publish offerte.md --password-env PB_PASSWORD
pastebucket publish offerte.md --password-file ~/.config/pastebucket/pw-offerte
```

### Status and revoking

> Wat is de status van publicatie AbCdEfGhIjKlMnOp?  → `get_output_status`
> Trek publicatie AbCdEfGhIjKlMnOp in.               → `revoke_output`

```bash
pastebucket status AbCdEfGhIjKlMnOp
pastebucket revoke AbCdEfGhIjKlMnOp     # --json for machine-readable output
```

You can pass a slug or a paste URL; only the slug is sent.

- Revoking takes effect immediately and deletes the stored ciphertext.
- It needs your token with `pastes:revoke`. A share link grants no management
  rights.
- Revoking does not reach copies the customer already downloaded or copied.

### Limits

`pastebucket limits` shows the server's values:

- maximum content size in bytes
- maximum expiry for your account

Oversized content is refused with both byte counts before anything is
encrypted or sent. It is never truncated. An expiry outside
`1..max_expiry_hours` is refused explicitly. A missing expiry means 7 days,
never unlimited.

## Retries and recovery data

Network errors, timeouts, HTTP 429 and 502/503/504 are retried up to 3 times.
Every retry uses the same `Idempotency-Key` and the same ciphertext. The server
returns the original paste, with its original expiry, instead of creating a
second one.

To survive a lost response across separate calls, the client writes a recovery
record to `<state dir>/pending/` **before** the first attempt. The record holds:

- the idempotency key
- the exact request body (ciphertext)
- the fragment key

Handling:

- Directory permissions are 0700, file permissions 0600.
- The file name is an HMAC under a local secret in `<state dir>/secret`.
- Publishing identical input (same URL, title, content, format, expiry and
  password) within **24 hours** reuses the record. You get the same link, and
  the key matches the stored content.
- The record is deleted as soon as the server confirms, or definitively refuses,
  the request.
- Records older than 24 hours are purged on the next publish.

A record is as sensitive as the document itself. Delete `<state dir>/pending/`
to discard it early.

## Not in this version

- A publicly hosted MCP server, or remote HTTP transport. This is a local stdio
  tool.
- Integration with the browser versions of ChatGPT or Claude.
- Automatic access to chat history, or summarising or selecting content on its
  own.
- Sending links to customers.
- Images and attachments.

## Development

```bash
npm run build          # tsc -> dist/
npm run typecheck
cd .. && npx vitest run mcp   # tests (run from the repository root)
```

End to end against a running instance, e.g. the local dev server:

```bash
PASTEBUCKET_E2E_URL=http://localhost:8040 PASTEBUCKET_E2E_TOKEN=… npx vitest run mcp/test/e2e.test.ts
```
