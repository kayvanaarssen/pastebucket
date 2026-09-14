import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * How long an unfinished publish stays recoverable. Long enough to survive a
 * crashed session or a flaky connection and be retried the same day; short
 * enough that a fragment key does not linger on disk.
 */
export const RECOVERY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface PendingRecord {
    version: 1;
    fingerprint: string;
    idempotency_key: string;
    created_at: string;
    /** The exact JSON body sent, so a retry is byte-identical. */
    body: string;
    /** Null in password mode, where there is no key to put in the link. */
    fragment_key: string | null;
}

/**
 * Local recovery data for publishes that have not been confirmed.
 *
 * The hazard it removes: a publish whose response is lost may still have been
 * stored. Encrypting afresh on the retry would give a new key and new
 * ciphertext -- a duplicate at best, and under a reused idempotency key a link
 * whose key does not open what the server holds. So the envelope and key are
 * written here before the first attempt and reused by any identical publish
 * within RECOVERY_LIFETIME_MS, and removed as soon as the server confirms.
 *
 * A record holds the ciphertext next to its key, which is as sensitive as the
 * plaintext this machine already had. Directory 0700, files 0600, and the
 * file name is an HMAC under a local secret rather than a hash of the content,
 * so the name alone does not confirm a guess about what was published.
 */
export class RecoveryStore {
    private readonly stateDir: string;
    private readonly now: () => number;
    private secret: Buffer | null = null;

    constructor(stateDir: string, now: () => number = Date.now) {
        this.stateDir = stateDir;
        this.now = now;
    }

    get pendingDir(): string {
        return join(this.stateDir, 'pending');
    }

    private async ensureDirs(): Promise<void> {
        await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
        await mkdir(this.pendingDir, { recursive: true, mode: 0o700 });
        // mkdir leaves an existing directory's mode alone; this one is ours.
        await chmod(this.pendingDir, 0o700).catch(() => {});
    }

    private async loadSecret(): Promise<Buffer> {
        if (this.secret) return this.secret;
        await this.ensureDirs();
        const path = join(this.stateDir, 'secret');

        try {
            await writeFile(path, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }

        this.secret = Buffer.from((await readFile(path, 'utf8')).trim(), 'hex');
        return this.secret;
    }

    /** Keyed fingerprint of everything that makes two publishes "the same". */
    async fingerprint(parts: unknown[]): Promise<string> {
        const secret = await this.loadSecret();
        return createHmac('sha256', secret).update(JSON.stringify(parts)).digest('hex');
    }

    private fileFor(fingerprint: string): string {
        return join(this.pendingDir, `${fingerprint}.json`);
    }

    private isStale(createdAt: number): boolean {
        return !Number.isFinite(createdAt) || this.now() - createdAt > RECOVERY_LIFETIME_MS;
    }

    async load(fingerprint: string): Promise<PendingRecord | null> {
        let record: PendingRecord;
        try {
            record = JSON.parse(await readFile(this.fileFor(fingerprint), 'utf8'));
        } catch {
            return null;
        }

        if (record.version !== 1 || record.fingerprint !== fingerprint || this.isStale(Date.parse(record.created_at))) {
            await this.remove(fingerprint);
            return null;
        }

        return record;
    }

    async save(record: PendingRecord): Promise<void> {
        await this.ensureDirs();
        const target = this.fileFor(record.fingerprint);
        const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
        await rename(temp, target);
    }

    async remove(fingerprint: string): Promise<void> {
        await unlink(this.fileFor(fingerprint)).catch(() => {});
    }

    /** Drop records (and orphaned temp files) older than the recovery lifetime. */
    async purge(): Promise<void> {
        let names: string[];
        try {
            names = await readdir(this.pendingDir);
        } catch {
            return;
        }

        await Promise.all(names.map(async name => {
            const path = join(this.pendingDir, name);
            let createdAt = NaN;

            if (name.endsWith('.json')) {
                try {
                    createdAt = Date.parse(JSON.parse(await readFile(path, 'utf8')).created_at);
                } catch {
                    // Unreadable record: fall back to its modification time.
                }
            }
            if (!Number.isFinite(createdAt)) {
                createdAt = await stat(path).then(s => s.mtimeMs, () => NaN);
            }

            if (this.isStale(createdAt)) await unlink(path).catch(() => {});
        }));
    }
}
