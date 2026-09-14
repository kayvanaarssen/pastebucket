import { describe, expect, test } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { Nodes } from 'mdast';
import {
    canonicalizeDoc,
    checkDocStorable,
    checkMarkdownEditable,
    codeBlockDoc,
    docToMarkdown,
    docsEqual,
    markdownToDoc,
    parseMarkdown,
    planConversion,
} from './markdown-doc';

/**
 * The mdast a reader's browser would render, minus things that do not change
 * the output: source positions, list looseness, and how a soft line break was
 * spelled. Comparing this is comparing what the customer view shows.
 */
function rendered(markdown: string): unknown {
    const strip = (node: Nodes): unknown => {
        const { position: _position, ...rest } = node as Nodes & { position?: unknown; spread?: unknown };
        delete (rest as { spread?: unknown }).spread;
        if ('value' in rest && typeof rest.value === 'string' && rest.type === 'text') {
            rest.value = rest.value.replace(/\n/g, ' ');
        }
        if ('children' in rest) {
            (rest as { children: unknown[] }).children = (rest.children as Nodes[]).map(strip);
        }
        return rest;
    };
    return strip(parseMarkdown(markdown));
}

/** Markdown -> editor -> Markdown must render the same and report nothing. */
function expectLossless(markdown: string): string {
    const { doc, issues } = markdownToDoc(markdown);
    expect(issues).toEqual([]);
    expect(checkMarkdownEditable(markdown)).toEqual([]);

    const output = docToMarkdown(doc);
    expect(rendered(output)).toEqual(rendered(markdown));
    expect(docsEqual(markdownToDoc(output).doc, doc)).toBe(true);
    return output;
}

describe('lossless round trips', () => {
    test('headings and inline marks', () => {
        expectLossless('# H1\n\n## H2 with **bold** and *em*\n\n###### H6 ~~gone~~ `code`');
        expectLossless('Some **bold**, *italic*, ~~strike~~, `code`, and [a link](https://example.com "A title").');
        expectLossless('Nested *italic with **bold** inside* and **bold with *italic* inside**.');
    });

    test('code inside links and bold keeps both marks', () => {
        expectLossless('Run [`npm install`](https://docs.npmjs.com) or **`composer install`** first.');
    });

    test('nested bullet and ordered lists', () => {
        expectLossless('- a\n- b\n  - b1\n    - b1a\n  - b2\n- c\n\n1. one\n2. two\n   1. two.one\n3. three');
        expectLossless('3. starts at three\n4. four');
    });

    test('checklists, nested', () => {
        const output = expectLossless('- [ ] todo\n- [x] done\n  - [ ] nested\n  - [x] nested done');
        expect(output).toContain('- [x] done');
    });

    test('blockquotes containing lists and code', () => {
        expectLossless('> quoted\n> line two\n>\n> - list in quote\n> - second\n>\n> ```sh\n> echo hi\n> ```');
    });

    test('tables with alignment, pipes, unicode and inline code', () => {
        const output = expectLossless(
            '| Name | Qty | Note |\n| :--- | ---: | :---: |\n| Äpfel | 3 | a \\| pipe |\n| Ωmega 🎉 | 10 | `x\\|y` **b** |',
        );
        expect(output).toContain('a \\| pipe');
    });

    test('code blocks keep every character of whitespace', () => {
        const code = 'def f():\n\treturn  1   \n\n\n    # indented\n\t\tdeep tab\n';
        const { doc } = markdownToDoc('```python\n' + code + '```');
        expect(doc.content![0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'python' } });
        expect(doc.content![0].content![0].text).toBe(code.replace(/\n$/, ''));
        expectLossless('```python\n' + code + '```');
    });

    test('code containing fences gets a longer fence', () => {
        const doc = codeBlockDoc('before\n```js\nconsole.log(1)\n```\n~~~\nafter', 'markdown');
        const output = docToMarkdown(doc);
        expect(output.startsWith('````markdown\n')).toBe(true);
        expect(markdownToDoc(output).doc).toEqual(doc);
    });

    test('code blocks inside list items keep tabs', () => {
        expectLossless('- item\n\n  ```go\n  \tfmt.Println("x")\n  \t\tdeeper\n  ```\n- next');
    });

    test('code language with a meta string survives', () => {
        const output = expectLossless('```js title="app.js"\nconst a = 1;\n```');
        expect(output).toContain('```js title="app.js"');
    });

    test('unicode and emoji', () => {
        expectLossless('Zwölf Boxkämpfer 日本語 🤖 — “quotes” ‘single’ … 👩‍👩‍👧 Z͑ͫ̓ͪ̂ͫ̽͏̴̙̤̞͉͚̯̞̠͍');
    });

    test('hard breaks and horizontal rules', () => {
        expectLossless('line one\\\nline two  \nline three\n\n---\n\nbelow');
    });

    test('reference links resolve into links', () => {
        const { doc, issues } = markdownToDoc('[docs][1]\n\n[1]: https://example.com "Docs"');
        expect(issues).toEqual([]);
        expect(docToMarkdown(doc)).toBe('[docs](https://example.com "Docs")\n');
    });

    test('bare URLs and e-mail addresses stay links', () => {
        expectLossless('See https://example.com/a_b?x=1 or www.example.org or mail info@example.com.');
    });
});

describe('escaping text the author typed', () => {
    const typed = (text: string): JSONContent => ({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });

    test.each([
        '# not a heading',
        '1. not a list',
        '2) not a list either',
        '- not a bullet',
        '+ not a bullet',
        '* not a bullet',
        '> not a quote',
        '=== not a setext underline',
        '--- not a rule',
        '    four spaces are not code',
        '\ttab at the start',
        'trailing spaces   ',
        'stars *a* and _b_ and `c` and [d] and <e> and ~f~ and a | pipe',
        'entities &amp; &copy; &#169; stay literal',
        'backslash \\ and \\* escaped star',
        '<script>alert(1)</script>',
        '``` not a fence',
        '[^1] not a footnote',
        '![not](an image)',
    ])('%s', text => {
        const doc = typed(text);
        expect(checkDocStorable(doc)).toEqual([]);
        const back = markdownToDoc(docToMarkdown(doc));
        expect(back.issues).toEqual([]);
        expect(back.doc).toEqual(doc);
    });

    test('text after a hard break is escaped like a new line', () => {
        const doc: JSONContent = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'first' },
                    { type: 'hardBreak' },
                    { type: 'text', text: '# second' },
                    { type: 'hardBreak' },
                    { type: 'text', text: '---' },
                    { type: 'hardBreak' },
                    { type: 'text', text: '  indented' },
                ],
            }],
        };
        expect(checkDocStorable(doc)).toEqual([]);
    });

    test('whitespace at the edge of bold moves outside instead of breaking it', () => {
        const doc: JSONContent = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'a' },
                    { type: 'text', text: ' bold ', marks: [{ type: 'bold' }] },
                    { type: 'text', text: 'b' },
                ],
            }],
        };
        expect(docToMarkdown(doc)).toBe('a **bold** b\n');
        expect(checkDocStorable(doc)).toEqual([]);
    });

    test('inline code with backticks and edge spaces', () => {
        for (const code of ['a`b', '`start', 'end`', ' padded ', '``double``']) {
            const doc: JSONContent = {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: code, marks: [{ type: 'code' }] }] }],
            };
            expect(markdownToDoc(docToMarkdown(doc)).doc).toEqual(doc);
        }
    });

    test('unsafe link targets never become links', () => {
        const { doc, issues } = markdownToDoc('[click](javascript:alert(1)) and [ok](https://example.com)');
        expect(issues.map(issue => issue.code)).toEqual(['unsafeLink']);
        expect(JSON.stringify(doc)).not.toContain('javascript:');
        expect(JSON.stringify(doc)).toContain('https://example.com');
    });
});

describe('reporting what cannot be carried over', () => {
    const codes = (markdown: string) => checkMarkdownEditable(markdown).map(issue => issue.code);

    test('raw HTML is kept visible as text and reported', () => {
        const { doc, issues } = markdownToDoc('para <b>raw</b>\n\n<div>block\nhtml</div>');
        expect(issues).toEqual([expect.objectContaining({ code: 'html', count: 3 })]);
        expect(JSON.stringify(doc)).toContain('<div>block');
    });

    test('images become links and are reported', () => {
        const { doc, issues } = markdownToDoc('![diagram](https://example.com/x.png)');
        expect(issues).toEqual([expect.objectContaining({ code: 'image', count: 1 })]);
        expect(doc.content![0].content![0]).toMatchObject({
            text: 'diagram',
            marks: [{ type: 'link', attrs: { href: 'https://example.com/x.png' } }],
        });
    });

    test('footnotes, numbered checklists and mixed lists', () => {
        expect(codes('Text[^1]\n\n[^1]: note')).toEqual(['footnote']);
        expect(codes('1. [ ] numbered task')).toEqual(['orderedTaskList']);
        expect(codes('- [ ] task\n- plain')).toEqual(['mixedTaskList']);
    });

    test('table cells with line breaks, lists or merged cells', () => {
        const cell = (content: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'tableCell', attrs, content });
        const table = (row: JSONContent[]): JSONContent => ({
            type: 'doc',
            content: [{
                type: 'table',
                content: [
                    { type: 'tableRow', content: [cell([{ type: 'paragraph', content: [{ type: 'text', text: 'H' }] }]), cell([{ type: 'paragraph' }])] },
                    { type: 'tableRow', content: row },
                ],
            }],
        });

        expect(checkDocStorable(table([
            cell([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }]),
            cell([{ type: 'paragraph' }]),
        ])).map(issue => issue.code)).toEqual(['tableCell']);

        expect(checkDocStorable(table([
            cell([{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }]),
            cell([{ type: 'paragraph' }]),
        ])).map(issue => issue.code)).toEqual(['tableCell']);

        expect(checkDocStorable(table([
            cell([{ type: 'paragraph', content: [{ type: 'text', text: 'wide' }] }], { colspan: 2 }),
        ])).map(issue => issue.code)).toEqual(['mergedCells']);
    });

    test('a heading with a line break is reported', () => {
        const doc: JSONContent = {
            type: 'doc',
            content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }],
        };
        expect(checkDocStorable(doc).map(issue => issue.code)).toEqual(['headingBreak']);
    });

    test('empty paragraphs and trailing breaks are not reported as loss', () => {
        const doc: JSONContent = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] },
                { type: 'paragraph' },
                { type: 'paragraph' },
                { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
                { type: 'paragraph' },
            ],
        };
        expect(checkDocStorable(doc)).toEqual([]);
    });
});

describe('planConversion', () => {
    test('Markdown source converts losslessly and keeps the original text', () => {
        const source = '# Title\n\n* item\n* item two\n';
        const plan = planConversion({ from: 'code', to: 'rich', content: source, language: 'markdown' });
        expect(plan).toMatchObject({ kind: 'lossless', to: 'rich', markdownSource: source });
    });

    test('Markdown with HTML is lossy and lists why', () => {
        const plan = planConversion({ from: 'code', to: 'rich', content: 'a <br> b', language: 'markdown' });
        expect(plan.kind).toBe('lossy');
        expect(plan.kind === 'lossy' && plan.issues.map(issue => issue.code)).toEqual(['html']);
    });

    test('code in another language offers a verbatim code block', () => {
        const content = '<?php\n\techo "*hi*";\n\n\n';
        const plan = planConversion({ from: 'code', to: 'rich', content, language: 'php' });
        expect(plan.kind).toBe('choice');
        if (plan.kind !== 'choice') return;

        expect(plan.asCodeBlock).toEqual(codeBlockDoc(content, 'php'));
        // The verbatim option really is verbatim: stored and read back exactly.
        expect(checkDocStorable(plan.asCodeBlock)).toEqual([]);
        expect(markdownToDoc(docToMarkdown(plan.asCodeBlock)).doc).toEqual(plan.asCodeBlock);
    });

    test('plain text read as Markdown keeps its line breaks', () => {
        const plan = planConversion({ from: 'code', to: 'rich', content: 'Dear customer,\nline two', language: '' });
        expect(plan.kind === 'choice' && plan.asMarkdown.doc.content![0].content).toEqual([
            { type: 'text', text: 'Dear customer,' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two' },
        ]);
    });

    test('an empty editor switches without asking', () => {
        expect(planConversion({ from: 'code', to: 'rich', content: '  \n', language: 'php' }).kind).toBe('lossless');
    });

    test('rich to code is lossless for representable documents', () => {
        const { doc } = markdownToDoc('## Done\n\n- [x] shipped');
        expect(planConversion({ from: 'rich', to: 'code', doc })).toEqual({
            kind: 'lossless',
            to: 'code',
            markdown: '## Done\n\n- [x] shipped\n',
        });
    });
});

describe('randomised documents survive storage', () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 20260914;
    const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
    const int = (max: number) => Math.floor(random() * max);

    const fragments = [
        'word', 'Zwölf', '日本', '🤖', '#', '1.', '2)', '-', '+', '*', '_', '`', '``', '~', '~~', '[', ']', '(', ')',
        '<', '>', '&amp;', '&', '|', '\\', '!', '=', ':', 'www.example.com', 'https://example.com/x_y', 'a@b.io',
        '    ', '\t', '"', "'", '.', ',', 'x', 'end',
    ];

    const text = () => Array.from({ length: 1 + int(5) }, () => pick(fragments)).join(pick(['', ' ']));
    const markSet = (): JSONContent['marks'] => {
        const marks: NonNullable<JSONContent['marks']> = [];
        if (random() < 0.25) marks.push({ type: 'bold' });
        if (random() < 0.25) marks.push({ type: 'italic' });
        if (random() < 0.15) marks.push({ type: 'strike' });
        if (random() < 0.15) marks.push({ type: 'code' });
        if (random() < 0.15) marks.push({ type: 'link', attrs: { href: pick(['https://example.com', 'https://x.test/a b', 'mailto:a@b.io', '/rel(1)']), title: pick([null, 'T "q"']) } });
        return marks;
    };

    // Formatted segments are separated by a plain space: overlapping or
    // glued-together emphasis is the one thing Markdown genuinely cannot
    // express, and checkDocStorable reports that instead.
    const inline = (allowBreaks: boolean): JSONContent[] => {
        const out: JSONContent[] = [];
        for (let i = 0, n = 1 + int(4); i < n; i++) {
            if (i > 0) out.push(allowBreaks && random() < 0.15 ? { type: 'hardBreak' } : { type: 'text', text: ' ' });
            const marks = markSet();
            const value = marks!.length && !marks!.some(m => m.type === 'code') ? text().trim() || 'x' : text();
            out.push(marks!.length ? { type: 'text', text: value, marks } : { type: 'text', text: value });
        }
        return out;
    };

    const block = (depth: number): JSONContent => {
        const kinds = ['paragraph', 'paragraph', 'heading', 'code', 'hr', 'table'];
        if (depth < 2) kinds.push('quote', 'bullet', 'ordered', 'task');
        const listItem = (type: string, attrs?: Record<string, unknown>): JSONContent => ({
            type,
            ...(attrs ? { attrs } : {}),
            content: [
                { type: 'paragraph', content: inline(true) },
                ...Array.from({ length: int(2) }, () => block(depth + 1)),
            ],
        });

        switch (pick(kinds)) {
            case 'heading':
                return { type: 'heading', attrs: { level: 1 + int(6) }, content: inline(false) };
            case 'code':
                return codeBlockDoc(
                    Array.from({ length: 1 + int(4) }, () => pick(['plain', '\tindented', '```', '~~~', '    four', '', 'trailing  ', '`x`'])).join('\n'),
                    pick([null, 'js', 'a b', 'we`ird']),
                ).content![0];
            case 'hr':
                return { type: 'horizontalRule' };
            case 'table': {
                const columns = 1 + int(3);
                return {
                    type: 'table',
                    content: Array.from({ length: 2 + int(2) }, (_, row) => ({
                        type: 'tableRow',
                        content: Array.from({ length: columns }, () => ({
                            type: row === 0 ? 'tableHeader' : 'tableCell',
                            attrs: { align: pick([null, 'left', 'center', 'right']) },
                            content: [{ type: 'paragraph', content: inline(false) }],
                        })),
                    })),
                };
            }
            case 'quote':
                return { type: 'blockquote', content: Array.from({ length: 1 + int(2) }, () => block(depth + 1)) };
            case 'bullet':
                return { type: 'bulletList', content: Array.from({ length: 1 + int(3) }, () => listItem('listItem')) };
            case 'ordered':
                return { type: 'orderedList', attrs: { start: 1 + int(20) }, content: Array.from({ length: 1 + int(3) }, () => listItem('listItem')) };
            case 'task':
                return { type: 'taskList', content: Array.from({ length: 1 + int(3) }, () => listItem('taskItem', { checked: random() < 0.5 })) };
            default:
                return { type: 'paragraph', content: inline(true) };
        }
    };

    test('300 generated documents serialize and parse back identically', () => {
        for (let i = 0; i < 300; i++) {
            const doc: JSONContent = { type: 'doc', content: Array.from({ length: 1 + int(4) }, () => block(0)) };
            const markdown = docToMarkdown(doc);
            const issues = checkDocStorable(doc);
            if (issues.length) {
                const blocks = (d: JSONContent) => (canonicalizeDoc(d).content ?? []).map(b => JSON.stringify(b));
                const expected = blocks(doc);
                const actual = blocks(markdownToDoc(markdown).doc);
                const at = expected.findIndex((b, n) => b !== actual[n]);
                throw new Error(
                    `Document ${i} not storable: ${JSON.stringify(issues)}\n--- markdown\n${markdown}\n`
                    + `--- expected block ${at}\n${expected[at]}\n--- actual block ${at}\n${actual[at]}`,
                );
            }
        }
    });
});
