// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import type { Editor as ReactEditor } from '@tiptap/react';
import { editorExtensions } from './extensions';
import { RichTextEditor } from './RichTextEditor';
import { checkDocStorable, docToMarkdown, emptyDoc, markdownToDoc } from '@/lib/markdown-doc';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: (() => void)[] = [];
afterEach(() => {
    mounted.splice(0).forEach(cleanup => cleanup());
});

function headlessEditor(markdown: string): Editor {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({ element, extensions: editorExtensions(), content: markdownToDoc(markdown).doc });
    mounted.push(() => {
        editor.destroy();
        element.remove();
    });
    return editor;
}

/** Position of the first node of a type, for commands that need one. */
function positionOf(editor: Editor, type: string): number {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
        if (found === -1 && node.type.name === type) found = pos;
        return found === -1;
    });
    return found;
}

describe('editor with the shared extensions', () => {
    const offer = '# Offerte\n\nBeste klant, zie **hieronder**:\n\n- [ ] akkoord\n- [x] ontvangen\n\n| Item | Prijs |\n| --- | ---: |\n| Hosting | € 12,50 |\n\n```bash\n\techo "klaar"\n```\n';

    test('Markdown loads into the editor and comes back unchanged', () => {
        const editor = headlessEditor(offer);
        expect(editor.getText()).toContain('Offerte');
        expect(checkDocStorable(editor.getJSON())).toEqual([]);
        expect(markdownToDoc(docToMarkdown(editor.getJSON())).doc).toEqual(markdownToDoc(offer).doc);
    });

    test('bold, undo and redo', () => {
        const editor = headlessEditor('Hello world');
        editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
        expect(docToMarkdown(editor.getJSON())).toBe('**Hello** world\n');

        editor.commands.undo();
        expect(docToMarkdown(editor.getJSON())).toBe('Hello world\n');

        editor.commands.redo();
        expect(docToMarkdown(editor.getJSON())).toBe('**Hello** world\n');
    });

    test('toggling a checklist item and editing a table', () => {
        const editor = headlessEditor(offer);

        const taskPos = positionOf(editor, 'taskItem');
        editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(taskPos, undefined, { checked: true });
            return true;
        });
        expect(docToMarkdown(editor.getJSON())).toContain('- [x] akkoord');

        // One command per transaction, as the toolbar does: prosemirror-tables
        // commands chained into a single transaction act on stale positions.
        editor.commands.setTextSelection(positionOf(editor, 'tableCell') + 2);
        editor.commands.addRowAfter();
        editor.commands.addColumnAfter();

        const markdown = docToMarkdown(editor.getJSON());
        expect(markdown).toContain('| Item |  | Prijs |\n| --- | --- | ---: |\n| Hosting |  | € 12,50 |\n|  |  |  |');
        expect(markdown).toContain('```bash\n\techo "klaar"\n```');
        expect(checkDocStorable(editor.getJSON())).toEqual([]);
    });

    test('inline code keeps a link and bold around it', () => {
        const editor = headlessEditor('Run [`npm ci`](https://docs.npmjs.com) and **`npm test`**.');
        expect(docToMarkdown(editor.getJSON())).toBe('Run [`npm ci`](https://docs.npmjs.com) and **`npm test`**.\n');
    });

    test('an unsafe link target is never rendered as a link', () => {
        const element = document.createElement('div');
        document.body.appendChild(element);
        const editor = new Editor({
            element,
            extensions: editorExtensions(),
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
            },
        });
        mounted.push(() => editor.destroy());
        expect(element.innerHTML).not.toContain('javascript:');
    });
});

describe('RichTextEditor paste handling', () => {
    async function mountEditor(): Promise<{ editor: ReactEditor; container: HTMLElement }> {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | undefined;
        let editor: ReactEditor | undefined;

        await act(async () => {
            root = createRoot(container);
            root.render(<RichTextEditor initialContent={emptyDoc()} onReady={instance => { editor = instance; }} />);
        });

        mounted.push(() => {
            act(() => root?.unmount());
            container.remove();
        });
        return { editor: editor!, container };
    }

    test('hostile pasted HTML becomes plain content and the dropped image is reported', async () => {
        const { editor, container } = await mountEditor();

        await act(async () => {
            editor.view.pasteHTML(
                '<meta charset="utf-8"><p onclick="steal()">Dear customer, <strong>bold</strong> '
                + '<img src="https://tracker.example/pixel.gif" onerror="alert(1)"> '
                + '<a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>'
                + '<script>alert(2)</script><ul><li>one</li><li>two</li></ul>',
            );
        });

        const markdown = docToMarkdown(editor.getJSON());
        expect(markdown).toBe('Dear customer, **bold** bad [good](https://example.com)\n\n- one\n- two\n');
        expect(container.innerHTML).not.toMatch(/<img|onclick|onerror|javascript:|<script/);
        expect(container.textContent).toContain('1 image (images are not supported yet)');
        expect(container.textContent).toContain('1 link with an unsafe address');
    });

    test('pasting only a file does not insert anything and is reported', async () => {
        const { editor, container } = await mountEditor();
        const file = new File(['x'], 'photo.png', { type: 'image/png' });
        const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
        Object.defineProperty(event, 'clipboardData', {
            value: { files: [file], types: ['Files'], getData: () => '' },
        });

        await act(async () => {
            editor.view.dom.dispatchEvent(event);
        });

        expect(editor.isEmpty).toBe(true);
        expect(container.textContent).toContain('1 file or attachment');
    });
});
