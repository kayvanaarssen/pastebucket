import { getSchema, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { Schema } from '@tiptap/pm/model';
import { isSafeUrl } from '@/lib/safe-url';

/**
 * The single list of editor extensions.
 *
 * Everything that reads or writes a formatted document -- the live editor, the
 * Markdown conversion, the storability check -- builds its schema from this
 * list, so "what the editor can hold" and "what we know how to store" cannot
 * drift apart. The list is deliberately limited to what GitHub-flavoured
 * Markdown can represent, because Markdown is the stored format:
 *
 *   - underline is off (Markdown has no underline without raw HTML),
 *   - there is no image node (images and attachments are out of scope),
 *   - tables have no column resizing (widths cannot be stored).
 */
export function editorExtensions(options: { placeholder?: string } = {}): AnyExtension[] {
    return [
        StarterKit.configure({
            underline: false,
            // Replaced below: the stock inline-code mark excludes every other
            // mark, so `[`npm install`](https://…)` or **`code`** -- both common
            // in assistant output -- would silently lose their link or bold.
            code: false,
            link: {
                openOnClick: false,
                autolink: true,
                linkOnPaste: true,
                defaultProtocol: 'https',
                protocols: ['http', 'https', 'mailto'],
                // Same rule the customer view applies, so a link that is
                // accepted here is never silently stripped for the reader.
                isAllowedUri: url => isSafeUrl(url),
            },
            codeBlock: {
                enableTabIndentation: true,
                tabSize: 4,
            },
        }),
        Code.extend({ excludes: '' }),
        TableKit.configure({ table: { resizable: false } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: options.placeholder ?? 'Start writing…' }),
    ];
}

let cachedSchema: Schema | null = null;

/** The editor schema, built headless so conversions run without a DOM. */
export function getEditorSchema(): Schema {
    cachedSchema ??= getSchema(editorExtensions());
    return cachedSchema;
}
