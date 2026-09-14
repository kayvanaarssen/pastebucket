import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether this module is the process entry point. Compared through realpath
 * because npm installs bins as symlinks, and argv[1] is the link, not the file.
 */
export function isMainModule(importMetaUrl: string): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
    } catch {
        return false;
    }
}
