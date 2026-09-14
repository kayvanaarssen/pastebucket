#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PastebucketClient, type ClientOptions, type PasteData, type PublishInput } from './client.ts';
import { loadConfig } from './config.ts';
import { PastebucketError } from './errors.ts';
import { isMainModule } from './main-module.ts';

export interface CliIO {
    stdout: { write(chunk: string): unknown };
    stderr: { write(chunk: string): unknown };
    stdin: AsyncIterable<Uint8Array | string>;
    env: Record<string, string | undefined>;
    cwd: string;
    clientOptions?: ClientOptions;
}

const USAGE = `Usage:
  pastebucket publish <file|-> [options]   Encrypt a file locally and publish it
  pastebucket status <slug>                Show status and exact expiry of your publication
  pastebucket revoke <slug>                Revoke your publication immediately
  pastebucket limits                       Show the server's limits
  pastebucket --help

Publish options:
  --title <text>          Neutral title (stored unencrypted). Default: "Shared document"
  --expires-days <n>      Days until expiry (default 7)
  --expires-hours <n>     Hours until expiry (instead of --expires-days)
  --format <f>            auto | markdown | text  (auto: .md/.markdown -> markdown, else text)
  --language <name>       Highlighting language for --format text (default: text)
  --password-env <VAR>    Read an optional password from environment variable VAR
  --password-file <path>  Read an optional password from a file (one trailing newline ignored)
  --json                  Print machine-readable JSON

The file is read exactly as stored (strict UTF-8) and published byte for byte:
nothing is summarised, reformatted or truncated. Only the named file is read.

Environment: PASTEBUCKET_URL, PASTEBUCKET_API_TOKEN (or PASTEBUCKET_API_TOKEN_FILE),
optional PASTEBUCKET_STATE_DIR.
`;

class UsageError extends Error {}

function parseWholeNumber(value: string | undefined, flag: string): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) throw new UsageError(`${flag} must be a whole number.`);
    return Number(value);
}

/** Strict decoding: invalid UTF-8 is refused rather than replaced with U+FFFD. */
function decodeExact(bytes: Uint8Array, what: string): string {
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new PastebucketError(`${what} is not valid UTF-8; nothing was published.`, 'invalid_input');
    }
}

async function readStdin(stdin: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stdin) {
        chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

async function readNamedFile(path: string, cwd: string): Promise<Uint8Array> {
    try {
        return await readFile(resolve(cwd, path));
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        throw new PastebucketError(
            code === 'ENOENT' ? `File not found: ${path}`
                : code === 'EISDIR' ? `${path} is a directory, not a file.`
                : `Could not read ${path}.`,
            'invalid_input',
        );
    }
}

function printStatus(io: CliIO, data: PasteData): void {
    io.stdout.write([
        `Slug:       ${data.slug}`,
        `Status:     ${data.status}`,
        `Created:    ${data.created_at}`,
        `Expires:    ${data.expires_at ?? 'never'}`,
        ...(data.revoked_at ? [`Revoked:    ${data.revoked_at}`] : []),
        `Format:     ${data.content_format}`,
        `Visibility: ${data.visibility}`,
        `Protection: ${data.encryption_mode === 'password' ? 'password' : 'key in link'}`,
        '',
    ].join('\n'));
}

async function publish(io: CliIO, args: string[], client: () => PastebucketClient): Promise<void> {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: {
            title: { type: 'string' },
            'expires-days': { type: 'string' },
            'expires-hours': { type: 'string' },
            format: { type: 'string', default: 'auto' },
            language: { type: 'string' },
            'password-env': { type: 'string' },
            'password-file': { type: 'string' },
            json: { type: 'boolean', default: false },
        },
    });

    if (positionals.length !== 1) throw new UsageError('publish needs exactly one file path, or "-" for stdin.');
    const source = positionals[0];

    const format = values.format;
    if (format !== 'auto' && format !== 'markdown' && format !== 'text') {
        throw new UsageError('--format must be auto, markdown or text.');
    }
    const isMarkdown = format === 'markdown'
        || (format === 'auto' && source !== '-' && ['.md', '.markdown'].includes(extname(source).toLowerCase()));
    if (isMarkdown && values.language) {
        throw new UsageError('--language only applies to --format text.');
    }

    if (values['expires-days'] !== undefined && values['expires-hours'] !== undefined) {
        throw new UsageError('Use either --expires-days or --expires-hours, not both.');
    }
    if (values['password-env'] !== undefined && values['password-file'] !== undefined) {
        throw new UsageError('Use either --password-env or --password-file, not both.');
    }

    let password: string | null = null;
    if (values['password-env'] !== undefined) {
        password = io.env[values['password-env']] ?? '';
        if (!password) throw new UsageError(`Environment variable ${values['password-env']} is empty or not set.`);
    }
    if (values['password-file'] !== undefined) {
        password = decodeExact(await readNamedFile(values['password-file'], io.cwd), 'The password file')
            .replace(/\r?\n$/, '');
        if (!password) throw new UsageError('The password file is empty.');
    }

    const bytes = source === '-' ? await readStdin(io.stdin) : await readNamedFile(source, io.cwd);
    const content = decodeExact(bytes, source === '-' ? 'Standard input' : source);

    const input: PublishInput = {
        content,
        title: values.title ?? null,
        contentFormat: isMarkdown ? 'markdown' : 'code',
        language: isMarkdown ? null : (values.language ?? 'text'),
        expiresInDays: parseWholeNumber(values['expires-days'], '--expires-days'),
        expiresInHours: parseWholeNumber(values['expires-hours'], '--expires-hours'),
        password,
    };

    const result = await client().publish(input);

    if (values.json) {
        io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
    }

    io.stdout.write([
        `Published:  ${result.share_url}`,
        `Slug:       ${result.slug}`,
        `Expires:    ${result.expires_at} (UTC)`,
        `Format:     ${result.content_format}, ${result.content_bytes} bytes${result.replayed ? ' (earlier attempt reused)' : ''}`,
        'The link has not been sent to anyone.',
        ...(result.password_protected ? ['Password-protected: share the password separately from the link.'] : []),
        '',
    ].join('\n'));
}

async function slugCommand(
    io: CliIO,
    args: string[],
    run: (slug: string) => Promise<PasteData>,
    after?: (data: PasteData) => string,
): Promise<void> {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: { json: { type: 'boolean', default: false } },
    });
    if (positionals.length !== 1) throw new UsageError('Give exactly one slug.');

    const data = await run(positionals[0]);
    if (values.json) {
        io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return;
    }
    printStatus(io, data);
    if (after) io.stdout.write(after(data));
}

/** Run the CLI. Returns the exit code: 0 success, 1 failure, 2 usage error. */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
    const [command, ...rest] = argv;

    if (!command || command === '--help' || command === '-h' || command === 'help') {
        (command ? io.stdout : io.stderr).write(USAGE);
        return command ? 0 : 2;
    }

    let client: PastebucketClient | null = null;
    const getClient = () => (client ??= new PastebucketClient(loadConfig(io.env), io.clientOptions));

    try {
        switch (command) {
            case 'publish':
                await publish(io, rest, getClient);
                return 0;
            case 'status':
                await slugCommand(io, rest, slug => getClient().status(slug));
                return 0;
            case 'revoke':
                await slugCommand(io, rest, slug => getClient().revoke(slug),
                    () => 'The link no longer works. Copies already downloaded are not affected.\n');
                return 0;
            case 'limits': {
                const limits = await getClient().limits();
                io.stdout.write(`${JSON.stringify(limits, null, 2)}\n`);
                return 0;
            }
            default:
                throw new UsageError(`Unknown command "${command}".`);
        }
    } catch (error) {
        if (error instanceof UsageError || (error as NodeJS.ErrnoException)?.code?.startsWith?.('ERR_PARSE_ARGS')) {
            io.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
            return 2;
        }
        io.stderr.write(`Error: ${error instanceof PastebucketError ? error.message : 'unexpected failure.'}\n`);
        return 1;
    }
}

if (isMainModule(import.meta.url)) {
    runCli(process.argv.slice(2), {
        stdout: process.stdout,
        stderr: process.stderr,
        stdin: process.stdin,
        env: process.env,
        cwd: process.cwd(),
    }).then(code => {
        process.exitCode = code;
    });
}
