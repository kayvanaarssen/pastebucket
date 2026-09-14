// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RichTextEditor } from './RichTextEditor';
import { ConvertedBanner, useEditorMode } from './useEditorMode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useEditorMode>;

let api: Api;
let code: { content: string; language: string };
const cleanups: (() => void)[] = [];

afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
});

/** A page in miniature: code state, the hook, the visual editor, the banner and dialogs. */
function Harness({ initial }: { initial: { content: string; language: string } }) {
    const [state, setState] = useState(initial);
    code = state;
    api = useEditorMode({
        getCode: () => ({ ...state, effectiveLanguage: state.language }),
        setCode: (content, language) => setState({ content, language }),
    });

    return (
        <div>
            {api.mode === 'rich' && <RichTextEditor key={api.editorKey} {...api.richProps} />}
            {api.original && <ConvertedBanner from={api.original.mode} onRestore={api.restore} />}
            {api.dialogs}
        </div>
    );
}

async function mount(content: string, language: string) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
        root = createRoot(container);
        root.render(<Harness initial={{ content, language }} />);
    });
    cleanups.push(() => {
        act(() => root?.unmount());
        container.remove();
    });
}

function button(label: string): HTMLButtonElement {
    const match = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
    if (!match) throw new Error(`No button "${label}" in: ${document.body.textContent}`);
    return match;
}

async function click(label: string) {
    await act(async () => button(label).click());
}

async function requestMode(mode: 'code' | 'rich') {
    await act(async () => api.requestMode(mode));
}

describe('useEditorMode', () => {
    test('a lossy switch asks first; Cancel changes nothing', async () => {
        const source = 'Intro <b>html</b>\n\n![logo](https://example.com/logo.png)\n';
        await mount(source, 'markdown');

        await requestMode('rich');
        expect(document.body.textContent).toContain('Some content cannot be shown in the visual editor');
        expect(document.body.textContent).toContain('Raw HTML');
        expect(document.body.textContent).toContain('Images');

        await click('Cancel');
        expect(api.mode).toBe('code');
        expect(code).toEqual({ content: source, language: 'markdown' });
        expect(api.original).toBeNull();
    });

    test('Convert anyway switches, and Restore original puts the source back exactly', async () => {
        const source = 'Intro <b>html</b>\n\n* star bullet\n';
        await mount(source, 'markdown');

        await requestMode('rich');
        await click('Convert anyway');
        expect(api.mode).toBe('rich');
        expect(document.body.textContent).toContain('Converted from Code / plain text');

        await click('Restore original');
        expect(api.mode).toBe('code');
        expect(code).toEqual({ content: source, language: 'markdown' });
    });

    test('code in another language can be kept verbatim as a code block', async () => {
        const php = '<?php\n\techo "*not markdown*";\n\n\n';
        await mount(php, 'php');

        await requestMode('rich');
        expect(document.body.textContent).toContain('How should this text become formatted text?');
        await click('Use a code block');

        expect(api.mode).toBe('rich');
        const markdown = await api.markdownForSave();
        expect(markdown).toBe('```php\n' + php + '\n```\n');
    });

    test('untouched Markdown is saved byte for byte, not re-serialized', async () => {
        // `*` bullets and a soft line break would both be rewritten by the serializer.
        const source = '# Title\n\n* one\n* two\n\nsoft\nbreak\n';
        await mount(source, 'markdown');

        await requestMode('rich');
        expect(api.mode).toBe('rich');
        expect(document.body.textContent).not.toContain('Convert anyway');
        await expect(api.markdownForSave()).resolves.toBe(source);

        await requestMode('code');
        expect(code.content).toBe(source);
    });

    test('a save that cannot be stored exactly asks first, and Cancel aborts it', async () => {
        await mount('', 'markdown');
        await requestMode('rich');

        // Build a table cell with a line break: not representable in GFM.
        const editor = (document.querySelector('.ProseMirror') as HTMLElement & { editor?: unknown }).editor as import('@tiptap/core').Editor;
        await act(async () => {
            editor.commands.insertTable({ rows: 2, cols: 1, withHeaderRow: true });
        });
        await act(async () => {
            editor.commands.insertContent('a');
        });
        await act(async () => {
            editor.commands.setHardBreak();
            editor.commands.insertContent('b');
        });

        let result: Promise<string | null> | undefined;
        await act(async () => {
            result = api.markdownForSave();
        });
        expect(document.body.textContent).toContain('Some formatting cannot be saved exactly');
        expect(document.body.textContent).toContain('Line breaks, lists or several paragraphs inside a table cell');

        await click('Cancel');
        await expect(result!).resolves.toBeNull();
    });
});
