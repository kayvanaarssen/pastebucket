/**
 * Conversion between stored Markdown and the visual editor's document.
 *
 * Formatted-text pastes are stored as GitHub-flavoured Markdown -- the simplest
 * format that holds everything the editor offers, readable without this app,
 * and the same format the API and MCP client publish. The editor itself works
 * on a ProseMirror document, so every load and every save crosses this file.
 *
 * Two rules keep that crossing honest:
 *
 *   1. Markdown is parsed with remark + remark-gfm, the parser behind the
 *      customer view (react-markdown). What the editor shows is what a reader
 *      will see, not a second parser's opinion of the same text.
 *   2. Nothing is lost silently. Parsing reports every construct the editor
 *      cannot hold (raw HTML, images, footnotes, ...), and the serializer is
 *      checked by parsing its own output back and comparing documents. Any
 *      difference is reported so the UI can warn before a lossy save.
 *
 * The serializer is our own rather than @tiptap/markdown's, which was measured
 * to drop data (unescaped `|` in table cells, a fixed ``` fence around code
 * that contains ```, no escaping of `#` or `1.` at the start of a line).
 */

import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import type { Definition, List, ListItem, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast';
import { getEditorSchema } from '@/components/editor/extensions';
import { isSafeUrl } from '@/lib/safe-url';

/* -------------------------------------------------------------------------- */
/* issues                                                                      */
/* -------------------------------------------------------------------------- */

export type IssueCode =
    | 'html'
    | 'image'
    | 'footnote'
    | 'orderedTaskList'
    | 'mixedTaskList'
    | 'unsafeLink'
    | 'unsupported'
    | 'tableCell'
    | 'mergedCells'
    | 'headingBreak'
    | 'formatting';

/** Something a conversion cannot carry over exactly, phrased for the author. */
export interface ConversionIssue {
    code: IssueCode;
    label: string;
    count: number;
}

const ISSUE_LABELS: Record<IssueCode, string> = {
    html: 'Raw HTML (kept as plain text, it is never rendered)',
    image: 'Images (turned into links, images are not supported)',
    footnote: 'Footnotes (kept as plain text)',
    orderedTaskList: 'Numbered checklists (they become unnumbered checklists)',
    mixedTaskList: 'Lists mixing checklist items and regular items (split into separate lists)',
    unsafeLink: 'Links with an unsupported address such as javascript: (link removed, text kept)',
    unsupported: 'Other Markdown elements the editor does not support (kept as plain text)',
    tableCell: 'Line breaks, lists or several paragraphs inside a table cell',
    mergedCells: 'Merged table cells',
    headingBreak: 'Line breaks inside a heading',
    formatting: 'Formatting that Markdown cannot express exactly',
};

class IssueList {
    private readonly issues = new Map<IssueCode, ConversionIssue>();

    add(code: IssueCode, label: string = ISSUE_LABELS[code]): void {
        const existing = this.issues.get(code);
        if (existing) {
            existing.count++;
        } else {
            this.issues.set(code, { code, label, count: 1 });
        }
    }

    get size(): number {
        return this.issues.size;
    }

    list(): ConversionIssue[] {
        return [...this.issues.values()];
    }
}

/* -------------------------------------------------------------------------- */
/* Markdown -> document                                                        */
/* -------------------------------------------------------------------------- */

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(markdown: string): Root {
    return processor.parse(markdown) as Root;
}

export interface MarkdownToDocOptions {
    /**
     * What a single newline inside a paragraph becomes. In Markdown it is a
     * space (that is how the customer view renders it), but text typed into
     * the code editor as plain text means its line breaks literally.
     */
    softBreaks?: 'space' | 'hard';
}

interface ParseContext {
    issues: IssueList;
    definitions: Map<string, Definition>;
    softBreaks: 'space' | 'hard';
}

type MarkJSON = { type: string; attrs?: Record<string, unknown> };

export function emptyDoc(): JSONContent {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** A document holding the text as one code block -- the lossless way in for code. */
export function codeBlockDoc(content: string, language: string | null): JSONContent {
    return {
        type: 'doc',
        content: [{
            type: 'codeBlock',
            attrs: { language: language || null },
            ...(content ? { content: [{ type: 'text', text: content }] } : {}),
        }],
    };
}

export function markdownToDoc(
    markdown: string,
    options: MarkdownToDocOptions = {},
): { doc: JSONContent; issues: ConversionIssue[] } {
    const tree = parseMarkdown(markdown);
    const ctx: ParseContext = {
        issues: new IssueList(),
        definitions: collectDefinitions(tree),
        softBreaks: options.softBreaks ?? 'space',
    };

    const content = convertBlocks(tree.children, ctx);

    return {
        doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
        issues: ctx.issues.list(),
    };
}

function collectDefinitions(tree: Root): Map<string, Definition> {
    const definitions = new Map<string, Definition>();
    const visit = (node: Nodes) => {
        if (node.type === 'definition' && !definitions.has(node.identifier)) {
            definitions.set(node.identifier, node);
        }
        if ('children' in node) node.children.forEach(child => visit(child as Nodes));
    };
    visit(tree);
    return definitions;
}

function plainText(node: Nodes): string {
    if ('value' in node && typeof node.value === 'string') return node.value;
    if ('children' in node) return (node.children as Nodes[]).map(plainText).join('');
    return '';
}

function paragraph(content: JSONContent[]): JSONContent {
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/** Text with newlines kept visible as hard breaks (used for literal HTML). */
function textWithBreaks(value: string, marks: MarkJSON[] = []): JSONContent[] {
    const out: JSONContent[] = [];
    value.split('\n').forEach((line, index) => {
        if (index > 0) out.push({ type: 'hardBreak' });
        if (line) out.push(textNode(line, marks));
    });
    return out;
}

function textNode(text: string, marks: MarkJSON[]): JSONContent {
    return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

function withMark(marks: MarkJSON[], mark: MarkJSON): MarkJSON[] {
    return [...marks.filter(existing => existing.type !== mark.type), mark];
}

function convertBlocks(nodes: RootContent[], ctx: ParseContext): JSONContent[] {
    return nodes.flatMap(node => convertBlock(node, ctx));
}

function convertBlock(node: RootContent, ctx: ParseContext): JSONContent[] {
    switch (node.type) {
        case 'paragraph':
            return [paragraph(convertInline(node.children, ctx))];

        case 'heading': {
            const content = convertInline(node.children, ctx);
            return [{ type: 'heading', attrs: { level: node.depth }, ...(content.length ? { content } : {}) }];
        }

        case 'thematicBreak':
            return [{ type: 'horizontalRule' }];

        case 'blockquote': {
            const content = convertBlocks(node.children, ctx);
            return [{ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] }];
        }

        case 'list':
            return convertList(node, ctx);

        case 'code': {
            // The info string after the fence is "lang meta"; keeping both in
            // the language attribute means `js title=x` survives a round trip.
            const info = [node.lang, node.meta].filter(Boolean).join(' ');
            return codeBlockDoc(node.value, info || null).content!;
        }

        case 'table':
            return [convertTable(node, ctx)];

        case 'html':
            ctx.issues.add('html');
            return [paragraph(textWithBreaks(node.value))];

        case 'footnoteDefinition': {
            ctx.issues.add('footnote');
            const content = convertBlocks(node.children, ctx);
            const label: JSONContent = { type: 'text', text: `[^${node.label ?? node.identifier}]: ` };
            if (content[0]?.type === 'paragraph') {
                content[0] = { ...content[0], content: [label, ...(content[0].content ?? [])] };
                return content;
            }
            return [paragraph([label]), ...content];
        }

        case 'definition':
            // Resolved into the links that reference it.
            return [];

        default: {
            ctx.issues.add('unsupported');
            const text = plainText(node as Nodes);
            return text ? [paragraph(textWithBreaks(text))] : [];
        }
    }
}

function convertList(node: List, ctx: ParseContext): JSONContent[] {
    // A GFM list can mix checklist items and plain items; the editor cannot,
    // so consecutive runs of each kind become their own lists.
    const runs: { task: boolean; items: ListItem[] }[] = [];
    for (const item of node.children) {
        const task = typeof item.checked === 'boolean';
        const last = runs[runs.length - 1];
        if (last && last.task === task) {
            last.items.push(item);
        } else {
            runs.push({ task, items: [item] });
        }
    }

    if (runs.length > 1) ctx.issues.add('mixedTaskList');

    let start = node.start ?? 1;
    return runs.map(run => {
        let list: JSONContent;
        if (run.task) {
            if (node.ordered) ctx.issues.add('orderedTaskList');
            list = {
                type: 'taskList',
                content: run.items.map(item => ({
                    type: 'taskItem',
                    attrs: { checked: item.checked === true },
                    content: listItemContent(item, ctx),
                })),
            };
        } else {
            const items = run.items.map(item => ({ type: 'listItem', content: listItemContent(item, ctx) }));
            list = node.ordered
                ? { type: 'orderedList', attrs: { start }, content: items }
                : { type: 'bulletList', content: items };
        }
        start += run.items.length;
        return list;
    });
}

function listItemContent(item: ListItem, ctx: ParseContext): JSONContent[] {
    const content = convertBlocks(item.children, ctx);
    // The editor's list items must open with a paragraph. An item that starts
    // with a code block renders identically with an empty one in front.
    if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' });
    return content;
}

function convertTable(node: Table, ctx: ParseContext): JSONContent {
    const columns = Math.max(node.align?.length ?? 0, ...node.children.map(row => row.children.length));
    return {
        type: 'table',
        content: node.children.map((row, rowIndex) => ({
            type: 'tableRow',
            content: Array.from({ length: columns }, (_, column) => ({
                type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
                attrs: { align: node.align?.[column] ?? null },
                content: [paragraph(convertInline(row.children[column]?.children ?? [], ctx))],
            })),
        })),
    };
}

function convertInline(nodes: PhrasingContent[], ctx: ParseContext, marks: MarkJSON[] = []): JSONContent[] {
    return nodes.flatMap(node => convertPhrasing(node, ctx, marks));
}

function linkMark(url: string, title: string | null | undefined): MarkJSON {
    return { type: 'link', attrs: { href: url, title: title ?? null } };
}

function convertPhrasing(node: PhrasingContent, ctx: ParseContext, marks: MarkJSON[]): JSONContent[] {
    switch (node.type) {
        case 'text': {
            if (!node.value) return [];
            if (ctx.softBreaks === 'hard') return textWithBreaks(node.value, marks);
            return [textNode(node.value.replace(/\n/g, ' '), marks)];
        }

        case 'strong':
            return convertInline(node.children, ctx, withMark(marks, { type: 'bold' }));

        case 'emphasis':
            return convertInline(node.children, ctx, withMark(marks, { type: 'italic' }));

        case 'delete':
            return convertInline(node.children, ctx, withMark(marks, { type: 'strike' }));

        case 'inlineCode':
            return node.value ? [textNode(node.value, withMark(marks, { type: 'code' }))] : [];

        case 'break':
            return [{ type: 'hardBreak' }];

        case 'link': {
            if (!isSafeUrl(node.url)) {
                ctx.issues.add('unsafeLink');
                return convertInline(node.children, ctx, marks);
            }
            return convertInline(node.children, ctx, withMark(marks, linkMark(node.url, node.title)));
        }

        case 'linkReference': {
            const definition = ctx.definitions.get(node.identifier);
            if (!definition) return convertInline(node.children, ctx, marks);
            if (!isSafeUrl(definition.url)) {
                ctx.issues.add('unsafeLink');
                return convertInline(node.children, ctx, marks);
            }
            return convertInline(node.children, ctx, withMark(marks, linkMark(definition.url, definition.title)));
        }

        case 'image':
        case 'imageReference': {
            ctx.issues.add('image');
            const target = node.type === 'image' ? node : ctx.definitions.get(node.identifier);
            const url = target?.url ?? '';
            const label = node.alt || url || 'image';
            if (url && isSafeUrl(url)) {
                return [textNode(label, withMark(marks, linkMark(url, target?.title)))];
            }
            return [textNode(label, marks)];
        }

        case 'html':
            ctx.issues.add('html');
            return textWithBreaks(node.value, marks);

        case 'footnoteReference':
            ctx.issues.add('footnote');
            return [textNode(`[^${node.label ?? node.identifier}]`, marks)];

        default: {
            ctx.issues.add('unsupported');
            const text = plainText(node as Nodes);
            return text ? textWithBreaks(text, marks) : [];
        }
    }
}

/* -------------------------------------------------------------------------- */
/* canonical form                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Documents that render identically but differ structurally are brought to one
 * shape before comparison, so the storability check only reports differences
 * a reader could notice. Each rule below mirrors something Markdown itself does:
 *
 *   - empty paragraphs vanish (blank lines separate blocks, they are not blocks),
 *   - trailing hard breaks vanish (a break needs something after it),
 *   - whitespace at the edge of bold/italic/strikethrough sits outside the mark
 *     (`** a**` is not bold in Markdown),
 *   - a bare URL or e-mail address is a link (GFM autolinks it on read),
 *   - the first table row is the header row, and alignment belongs to columns,
 *   - link attributes Markdown cannot carry (target, rel, class) are defaults.
 */

type InlineToken = { kind: 'text'; text: string; marks: MarkJSON[] } | { kind: 'break' };

const EDGE_TRIMMED_MARKS = ['bold', 'italic', 'strike'];

function sameMark(a: MarkJSON, b: MarkJSON): boolean {
    if (a.type !== b.type) return false;
    if (a.type !== 'link') return true;
    return (a.attrs?.href ?? null) === (b.attrs?.href ?? null)
        && (a.attrs?.title ?? null) === (b.attrs?.title ?? null);
}

function sameMarks(a: MarkJSON[], b: MarkJSON[]): boolean {
    return a.length === b.length && a.every(mark => b.some(other => sameMark(mark, other)));
}

function cleanMarks(marks: JSONContent['marks']): MarkJSON[] {
    return (marks ?? []).map(mark => mark.type === 'link'
        ? { type: 'link', attrs: { href: mark.attrs?.href ?? null, title: mark.attrs?.title ?? null } }
        : { type: mark.type });
}

function toTokens(content: JSONContent[] | undefined): InlineToken[] {
    const tokens: InlineToken[] = [];
    for (const node of content ?? []) {
        if (node.type === 'hardBreak') {
            tokens.push({ kind: 'break' });
        } else if (node.type === 'text' && node.text) {
            const marks = cleanMarks(node.marks);
            node.text.split('\n').forEach((part, index) => {
                if (index > 0) tokens.push({ kind: 'break' });
                if (part) tokens.push({ kind: 'text', text: part, marks });
            });
        }
    }
    return tokens;
}

/** ProseMirror keeps marks in schema order; canonical JSON does the same. */
const MARK_RANK = ['link', 'bold', 'code', 'italic', 'strike'];

function fromTokens(tokens: InlineToken[]): JSONContent[] {
    return tokens.map(token => token.kind === 'break'
        ? { type: 'hardBreak' }
        : textNode(token.text, [...token.marks].sort((a, b) => MARK_RANK.indexOf(a.type) - MARK_RANK.indexOf(b.type))));
}

function mergeTokens(tokens: InlineToken[]): InlineToken[] {
    const out: InlineToken[] = [];
    for (const token of tokens) {
        const last = out[out.length - 1];
        if (token.kind === 'text' && last?.kind === 'text' && sameMarks(last.marks, token.marks)) {
            out[out.length - 1] = { ...last, text: last.text + token.text };
        } else if (token.kind === 'break' || token.text) {
            out.push(token);
        }
    }
    return out;
}

/** Move whitespace at the edges of a bold/italic/strike span outside the mark. */
function expelEdgeWhitespace(input: InlineToken[]): InlineToken[] {
    let tokens = mergeTokens(input);

    for (const type of EDGE_TRIMMED_MARKS) {
        const has = (token: InlineToken | undefined) =>
            token?.kind === 'text' && token.marks.some(mark => mark.type === type);

        let changed = true;
        while (changed) {
            changed = false;
            const out: InlineToken[] = [];
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token.kind !== 'text' || !has(token)) {
                    out.push(token);
                    continue;
                }
                const without = token.marks.filter(mark => mark.type !== type);
                const opensSpan = !has(tokens[i - 1]);
                const closesSpan = !has(tokens[i + 1]);
                let text = token.text;
                let lead = '';
                let trail = '';
                if (opensSpan) {
                    lead = text.match(/^\s+/)?.[0] ?? '';
                    text = text.slice(lead.length);
                }
                if (closesSpan && text) {
                    trail = text.match(/\s+$/)?.[0] ?? '';
                    text = text.slice(0, text.length - trail.length);
                }
                if (lead || trail) changed = true;
                if (lead) out.push({ kind: 'text', text: lead, marks: without });
                if (text) out.push({ kind: 'text', text, marks: token.marks });
                if (trail) out.push({ kind: 'text', text: trail, marks: without });
            }
            tokens = mergeTokens(out);
        }
    }

    return tokens;
}

const autolinkTransform = gfmAutolinkLiteralFromMarkdown().transforms![0];

/** Apply GFM's own autolink-literal rule to text that carries no link or code mark. */
function applyAutolinks(tokens: InlineToken[]): InlineToken[] {
    const out: InlineToken[] = [];
    for (const token of tokens) {
        if (token.kind !== 'text' || token.marks.some(mark => mark.type === 'link' || mark.type === 'code')) {
            out.push(token);
            continue;
        }
        const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: token.text }] }] };
        autolinkTransform(tree as never);
        const children = (tree.children[0] as { children: PhrasingContent[] }).children;
        for (const child of children) {
            if (child.type === 'link') {
                out.push({
                    kind: 'text',
                    text: plainText(child),
                    marks: [...token.marks, { type: 'link', attrs: { href: child.url, title: child.title ?? null } }],
                });
            } else {
                out.push({ kind: 'text', text: plainText(child as Nodes), marks: token.marks });
            }
        }
    }
    return mergeTokens(out);
}

function canonicalInline(content: JSONContent[] | undefined, autolinks: boolean): JSONContent[] {
    let tokens = expelEdgeWhitespace(toTokens(content));
    while (tokens.length && tokens[tokens.length - 1].kind === 'break') tokens.pop();
    if (autolinks) tokens = applyAutolinks(tokens);
    return fromTokens(tokens);
}

function isEmptyParagraph(node: JSONContent): boolean {
    return node.type === 'paragraph' && !(node.content ?? []).some(child => child.type === 'text' && child.text);
}

export function canonicalizeDoc(doc: JSONContent, options: { autolinks?: boolean } = {}): JSONContent {
    const autolinks = options.autolinks ?? true;

    const visit = (node: JSONContent): JSONContent => {
        switch (node.type) {
            case 'paragraph':
            case 'heading': {
                const content = canonicalInline(node.content, autolinks);
                const attrs = node.type === 'heading' ? { attrs: { level: node.attrs?.level ?? 1 } } : {};
                return { type: node.type, ...attrs, ...(content.length ? { content } : {}) };
            }
            case 'codeBlock': {
                const language = typeof node.attrs?.language === 'string' ? node.attrs.language.trim() : '';
                const text = (node.content ?? []).map(child => child.text ?? '').join('');
                return { type: 'codeBlock', attrs: { language: language || null }, ...(text ? { content: [{ type: 'text', text }] } : {}) };
            }
            case 'horizontalRule':
                return { type: 'horizontalRule' };
            case 'table':
                return canonicalTable(node);
            default:
                break;
        }

        const children = (node.content ?? []).map(visit);
        let content: JSONContent[];

        if (node.type === 'listItem' || node.type === 'taskItem') {
            // The leading paragraph is structural; empties after it are not.
            content = children.filter((child, index) => index === 0 || !isEmptyParagraph(child));
        } else {
            content = children.filter(child => !isEmptyParagraph(child));
            if (!content.length) content = [{ type: 'paragraph' }];
        }

        const result: JSONContent = { type: node.type, content };
        if (node.type === 'orderedList') result.attrs = { start: node.attrs?.start ?? 1 };
        if (node.type === 'taskItem') result.attrs = { checked: node.attrs?.checked === true };
        return result;
    };

    const canonicalTable = (table: JSONContent): JSONContent => {
        const rows = table.content ?? [];
        const header = rows[0]?.content ?? [];
        return {
            type: 'table',
            content: rows.map((row, rowIndex) => ({
                type: 'tableRow',
                content: (row.content ?? []).map((cell, column) => {
                    const cellContent = (cell.content ?? []).map(visit).filter(child => !isEmptyParagraph(child));
                    return {
                        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
                        attrs: {
                            colspan: cell.attrs?.colspan ?? 1,
                            rowspan: cell.attrs?.rowspan ?? 1,
                            colwidth: null,
                            align: header[column]?.attrs?.align ?? null,
                        },
                        content: cellContent.length ? cellContent : [{ type: 'paragraph' }],
                    };
                }),
            })),
        };
    };

    return visit(doc);
}

/* -------------------------------------------------------------------------- */
/* document -> Markdown                                                        */
/* -------------------------------------------------------------------------- */

export function docToMarkdown(doc: JSONContent): string {
    // Bare URLs are written as explicit autolinks. GFM autolinks them on read
    // anyway, and inside emphasis it does so on the raw source -- so a bare
    // URL whose `_` got escaped would come back with a backslash in it.
    const canonical = canonicalizeDoc(doc, { autolinks: true });
    const markdown = serializeBlocks(canonical.content ?? []);
    return markdown ? `${markdown}\n` : '';
}

function serializeBlocks(nodes: JSONContent[]): string {
    const parts: string[] = [];
    let previous: JSONContent | null = null;
    let bulletChar = '-';
    let orderedDelimiter = '.';

    for (const node of nodes) {
        // Two lists of the same family next to each other would be read back
        // as one list. CommonMark starts a new list when the marker changes.
        const isBulletFamily = (n: JSONContent | null) => n?.type === 'bulletList' || n?.type === 'taskList';
        if (isBulletFamily(node)) {
            bulletChar = isBulletFamily(previous) ? (bulletChar === '-' ? '*' : '-') : '-';
        }
        if (node.type === 'orderedList') {
            orderedDelimiter = previous?.type === 'orderedList' ? (orderedDelimiter === '.' ? ')' : '.') : '.';
        }

        parts.push(serializeBlock(node, { bulletChar, orderedDelimiter }));
        previous = node;
    }

    return parts.join('\n\n');
}

function indent(text: string, width: number): string {
    const pad = ' '.repeat(width);
    return text.split('\n').map(line => (line === '' ? '' : pad + line)).join('\n');
}

function serializeBlock(node: JSONContent, markers: { bulletChar: string; orderedDelimiter: string }): string {
    switch (node.type) {
        case 'paragraph':
            return serializeInline(node.content ?? [], { context: 'paragraph' });

        case 'heading': {
            const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
            const text = serializeInline(node.content ?? [], { context: 'heading' });
            return text ? `${'#'.repeat(level)} ${text}` : '#'.repeat(level);
        }

        case 'horizontalRule':
            return '---';

        case 'blockquote':
            return serializeBlocks(node.content ?? [])
                .split('\n')
                .map(line => (line === '' ? '>' : `> ${line}`))
                .join('\n');

        case 'bulletList':
        case 'taskList':
        case 'orderedList':
            return serializeList(node, markers);

        case 'codeBlock':
            return serializeCodeBlock(node);

        case 'table':
            return serializeTable(node);

        default:
            return serializeInline(node.content ?? [], { context: 'paragraph' });
    }
}

function serializeList(node: JSONContent, markers: { bulletChar: string; orderedDelimiter: string }): string {
    const items = node.content ?? [];
    let number = Number(node.attrs?.start ?? 1);

    const rendered = items.map(item => {
        let marker: string;
        if (node.type === 'orderedList') {
            marker = `${number++}${markers.orderedDelimiter}`;
        } else if (node.type === 'taskList') {
            marker = `${markers.bulletChar} [${item.attrs?.checked ? 'x' : ' '}]`;
        } else {
            marker = markers.bulletChar;
        }

        // Continuation lines align with the item's content. For a checklist
        // the checkbox belongs to the paragraph, so the indent is the bullet's.
        const width = node.type === 'taskList' ? markers.bulletChar.length + 1 : marker.length + 1;
        const children = item.content ?? [];

        let body = '';
        children.forEach((child, index) => {
            const text = serializeBlocks([child]);
            if (index === 0) {
                body = text;
            } else {
                // A nested list may hug its parent line, except an ordered list
                // not starting at 1: CommonMark only lets those begin after a
                // blank line, otherwise "7. x" continues the paragraph above.
                const hugs = child.type === 'bulletList'
                    || child.type === 'taskList'
                    || (child.type === 'orderedList' && Number(child.attrs?.start ?? 1) === 1);
                body += (hugs && body !== '' ? '\n' : '\n\n') + text;
            }
        });

        const [first, ...rest] = body.split('\n');
        const restText = rest.length ? '\n' + indent(rest.join('\n'), width) : '';
        return (first === '' ? marker : `${marker} ${first}`) + restText;
    });

    const loose = items.some(item => (item.content ?? []).length > 1 && rendered.some(r => r.includes('\n\n')));
    return rendered.join(loose ? '\n\n' : '\n');
}

function serializeCodeBlock(node: JSONContent): string {
    const text = (node.content ?? []).map(child => child.text ?? '').join('');
    const language = typeof node.attrs?.language === 'string' ? node.attrs.language.replace(/[\r\n]+/g, ' ').trim() : '';
    // A backtick fence cannot carry backticks in its info string.
    const char = language.includes('`') ? '~' : '`';
    const longestRun = Math.max(0, ...(text.match(char === '`' ? /`+/g : /~+/g) ?? []).map(run => run.length));
    const fence = char.repeat(Math.max(3, longestRun + 1));
    return text ? `${fence}${language}\n${text}\n${fence}` : `${fence}${language}\n${fence}`;
}

function serializeTable(node: JSONContent): string {
    const rows = node.content ?? [];
    const columns = Math.max(1, ...rows.map(row => (row.content ?? []).length));

    const cellText = (cell: JSONContent | undefined): string => {
        if (!cell) return '';
        // Cells are single-line in GFM. Anything richer is flattened here and
        // reported by checkDocStorable before the author saves.
        return (cell.content ?? [])
            .map(block => serializeInline(block.type === 'paragraph' ? block.content ?? [] : flattenToInline(block), { context: 'cell' }))
            .join(' ');
    };

    const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
    const header = rows[0]?.content ?? [];
    const delimiter = Array.from({ length: columns }, (_, column) => {
        switch (header[column]?.attrs?.align) {
            case 'left': return ':---';
            case 'center': return ':---:';
            case 'right': return '---:';
            default: return '---';
        }
    });

    return [
        line(Array.from({ length: columns }, (_, column) => cellText(header[column]))),
        line(delimiter),
        ...rows.slice(1).map(row => line(Array.from({ length: columns }, (_, column) => cellText(row.content?.[column])))),
    ].join('\n');
}

function flattenToInline(node: JSONContent): JSONContent[] {
    if (node.type === 'text' || node.type === 'hardBreak') return [node];
    return (node.content ?? []).flatMap(flattenToInline);
}

/* -------------------------------------------------------------------------- */
/* inline serialization                                                        */
/* -------------------------------------------------------------------------- */

type InlineContext = 'paragraph' | 'heading' | 'cell';

const DELIMITERS: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };

const charRef = (char: string) => `&#${char.codePointAt(0)};`;

function escapeText(text: string): string {
    return text
        // Characters that open inline syntax anywhere in a line. `|` is always
        // escaped: a paragraph line can otherwise become a table header row.
        .replace(/[\\`*_[\]<~|]/g, '\\$&')
        // `&copy;` or `&#169;` typed as text must not turn into the character.
        .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
        // Text reaching this point is not a link: canonicalizeDoc already turned
        // everything GFM would autolink into one. But GFM's autolink scanner
        // also runs on raw source right after `*`, `_`, `~` or `(`, where the
        // backslashes added above would end up inside -- or cut short -- a
        // "link" nobody asked for. Spelling the first character of a trigger
        // as a character reference keeps the scanner from starting; the
        // rendered text is identical.
        .replace(/(^|[^A-Za-z0-9])([wW])(?=[wW]{2}\.)/g, (_, before, char) => before + charRef(char))
        .replace(/(^|[^A-Za-z0-9])([hH])(?=[tT]{2}[pP][sS]?:\/\/)/g, (_, before, char) => before + charRef(char))
        .replace(/([A-Za-z0-9._+-])@/g, (_, before) => `${before}${charRef('@')}`);
}

/** Whitespace that Markdown would strip at a line edge, spelled as references. */
function encodeWhitespace(whitespace: string): string {
    return [...whitespace].map(char => (char === '\t' ? '&#9;' : `&#${char.codePointAt(0)};`)).join('');
}

/** Characters that start a block when they open a line. */
function escapeLineStart(text: string): string {
    if (/^[#>+=\-]/.test(text)) return `\\${text}`;
    return text.replace(/^(\d{1,9})([.)])/, '$1\\$2');
}

function codeSpan(text: string, context: InlineContext): string {
    const content = context === 'cell' ? text.replace(/\|/g, '\\|') : text;
    const longestRun = Math.max(0, ...(content.match(/`+/g) ?? []).map(run => run.length));
    const fence = '`'.repeat(longestRun + 1);
    // A span that starts or ends with a backtick, or has a space at both ends,
    // needs one padding space each side (CommonMark strips exactly one).
    const pad = /^`|`$/.test(content) || (/^ /.test(content) && / $/.test(content) && content.trim() !== '') ? ' ' : '';
    return `${fence}${pad}${content}${pad}${fence}`;
}

/** Character references are decoded in destinations and titles too: `&amp;` must stay `&amp;`. */
const ENTITY_LIKE = /&(?=#?[A-Za-z0-9]+;)/g;

function linkDestination(href: string, context: InlineContext): string {
    // In a table cell a bare `|` ends the cell wherever it appears.
    const pipes = (value: string) => (context === 'cell' ? value.replace(/\|/g, '\\|') : value);
    if (href !== '' && /^[^\s<>()\\|&]+$/.test(href)) return href;
    const escaped = href.replace(/[\\<>]/g, '\\$&').replace(ENTITY_LIKE, '\\&').replace(/\n/g, '%0A');
    return `<${pipes(escaped)}>`;
}

function linkClose(mark: MarkJSON, context: InlineContext): string {
    const href = String(mark.attrs?.href ?? '');
    const title = mark.attrs?.title;
    const escapedTitle = typeof title === 'string' ? title.replace(/[\\"]/g, '\\$&').replace(ENTITY_LIKE, '\\&') : '';
    const titlePart = escapedTitle !== '' ? ` "${context === 'cell' ? escapedTitle.replace(/\|/g, '\\|') : escapedTitle}"` : '';
    return `](${linkDestination(href, context)}${titlePart})`;
}

const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * `<https://…>` or `<name@host>` for a link whose text is its own address.
 * The angle form is taken literally (no escapes inside), which is exactly what
 * a URL needs.
 */
function angleAutolink(text: string, link: MarkJSON, context: InlineContext): string | null {
    const href = String(link.attrs?.href ?? '');
    if (link.attrs?.title) return null;
    if (context === 'cell' && text.includes('|')) return null;
    if (/&#?[A-Za-z0-9]+;/.test(text)) return null;
    if (text === href && /^https?:\/\/[^\s<> -]+$/i.test(href)) return `<${href}>`;
    if (href === `mailto:${text}` && EMAIL.test(text)) return `<${text}>`;
    return null;
}

function serializeInline(content: JSONContent[], options: { context: InlineContext }): string {
    const { context } = options;
    const tokens = expelEdgeWhitespace(toTokens(content));
    while (tokens.length && tokens[tokens.length - 1].kind === 'break') tokens.pop();

    let out = '';
    let lineStart = true;
    const stack: MarkJSON[] = [];

    const open = (mark: MarkJSON) => {
        out += mark.type === 'link' ? '[' : DELIMITERS[mark.type] ?? '';
        stack.push(mark);
        lineStart = false;
    };
    const close = () => {
        const mark = stack.pop()!;
        out += mark.type === 'link' ? linkClose(mark, context) : DELIMITERS[mark.type] ?? '';
    };

    const hasLink = (token: InlineToken | undefined, link: MarkJSON) =>
        token?.kind === 'text' && token.marks.some(mark => sameMark(mark, link));

    const runLength = (from: number, mark: MarkJSON) => {
        let length = 0;
        for (let i = from; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.kind === 'break') continue;
            if (!token.marks.some(m => sameMark(m, mark))) break;
            length += token.text.length;
        }
        return length;
    };

    tokens.forEach((token, index) => {
        if (token.kind === 'break') {
            // A closing delimiter at the start of the next line cannot close
            // anything, so marks that end here close before the break.
            const following = tokens.slice(index + 1).find(t => t.kind === 'text');
            const continuing = following?.kind === 'text' ? following.marks : [];
            let keep = 0;
            while (keep < stack.length && continuing.some(mark => sameMark(mark, stack[keep]))) keep++;
            while (stack.length > keep) close();

            out += context === 'paragraph' ? '\\\n' : ' ';
            lineStart = context === 'paragraph';
            return;
        }

        const isCode = token.marks.some(mark => mark.type === 'code');
        const link = token.marks.find(mark => mark.type === 'link');
        // A link that covers exactly this text and points at it is written in
        // angle form, with any other marks around it.
        const autolink = link && !isCode && !hasLink(tokens[index - 1], link) && !hasLink(tokens[index + 1], link)
            ? angleAutolink(token.text, link, context)
            : null;
        const target = token.marks.filter(mark => mark.type !== 'code' && !(autolink && mark.type === 'link'));

        let keep = 0;
        while (keep < stack.length && target.some(mark => sameMark(mark, stack[keep]))) keep++;
        while (stack.length > keep) close();

        target
            .filter(mark => !stack.some(active => sameMark(active, mark)))
            // Open the longest-lasting mark first so it does not have to be
            // closed and reopened when a shorter one ends.
            .sort((a, b) => runLength(index, b) - runLength(index, a))
            .forEach(open);

        if (isCode) {
            out += codeSpan(token.text, context);
            lineStart = false;
            return;
        }

        if (autolink) {
            out += autolink;
            lineStart = false;
            return;
        }

        // Markdown strips whitespace at the edges of a line (and of a heading
        // or table cell). Where the author put some there, spell it out.
        const next = tokens[index + 1];
        const atLineEnd = !next || (context === 'paragraph' && next.kind === 'break');
        let text = token.text;
        let lead = '';
        let trail = '';

        if (lineStart) {
            lead = text.match(/^[ \t]+/)?.[0] ?? '';
            text = text.slice(lead.length);
        }
        if (atLineEnd) {
            trail = text.match(/[ \t]+$/)?.[0] ?? '';
            text = text.slice(0, text.length - trail.length);
        }

        let escaped = escapeText(text);
        if (lineStart && !lead && context === 'paragraph') escaped = escapeLineStart(escaped);
        if (context === 'heading' && !next && stack.length === 0) {
            // A trailing run of `#` would be read as the closing sequence.
            escaped = escaped.replace(/#+$/, run => run.replace(/#/g, '\\#'));
        }

        out += encodeWhitespace(lead) + escaped + encodeWhitespace(trail);
        if (out !== '') lineStart = false;
    });

    while (stack.length) close();
    return out;
}

/* -------------------------------------------------------------------------- */
/* checks                                                                      */
/* -------------------------------------------------------------------------- */

function schema(): Schema {
    return getEditorSchema();
}

export function docsEqual(a: JSONContent, b: JSONContent): boolean {
    try {
        const left = schema().nodeFromJSON(canonicalizeDoc(a));
        const right = schema().nodeFromJSON(canonicalizeDoc(b));
        return left.eq(right);
    } catch {
        return false;
    }
}

function textOf(node: JSONContent): string {
    if (node.text) return node.text;
    return (node.content ?? []).map(textOf).join(node.type === 'paragraph' ? '' : ' ');
}

/** First textblock whose canonical form differs, for a pointer in the warning. */
function firstDifference(a: JSONContent, b: JSONContent): string | null {
    const flatten = (node: JSONContent, out: JSONContent[] = []): JSONContent[] => {
        if (['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '')) {
            out.push(node);
        } else {
            (node.content ?? []).forEach(child => flatten(child, out));
        }
        return out;
    };
    const left = flatten(canonicalizeDoc(a));
    const right = flatten(canonicalizeDoc(b));
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        if (JSON.stringify(left[i]) !== JSON.stringify(right[i])) {
            const text = textOf(left[i] ?? right[i] ?? {}).trim();
            return text ? (text.length > 60 ? `${text.slice(0, 57)}…` : text) : null;
        }
    }
    return null;
}

/**
 * Can this editor document be stored as Markdown without changing?
 *
 * Serializes, parses the result back exactly as the customer view will, and
 * compares. An empty list means the save is lossless.
 */
export function checkDocStorable(doc: JSONContent): ConversionIssue[] {
    const issues = new IssueList();

    const visit = (node: JSONContent) => {
        if (node.type === 'tableCell' || node.type === 'tableHeader') {
            if ((node.attrs?.colspan ?? 1) > 1 || (node.attrs?.rowspan ?? 1) > 1) issues.add('mergedCells');
            const blocks = (node.content ?? []).filter(child => !isEmptyParagraph(child));
            const breaks = (node.content ?? []).some(child => (child.content ?? []).some(inline => inline.type === 'hardBreak'));
            if (blocks.length > 1 || blocks.some(block => block.type !== 'paragraph') || breaks) issues.add('tableCell');
        }
        if (node.type === 'heading' && (node.content ?? []).some(inline => inline.type === 'hardBreak')) {
            issues.add('headingBreak');
        }
        (node.content ?? []).forEach(visit);
    };
    visit(doc);

    const back = markdownToDoc(docToMarkdown(doc)).doc;
    if (issues.size === 0 && !docsEqual(doc, back)) {
        const near = firstDifference(doc, back);
        issues.add('formatting', near ? `${ISSUE_LABELS.formatting} (near “${near}”)` : ISSUE_LABELS.formatting);
    }

    return issues.list();
}

/**
 * Can stored Markdown be opened in the visual editor and saved again without
 * losing anything? Combines what parsing could not represent with a check
 * that the serializer reproduces the parsed document.
 */
export function checkMarkdownEditable(markdown: string): ConversionIssue[] {
    const { doc, issues } = markdownToDoc(markdown);
    if (issues.length) return issues;
    return checkDocStorable(doc);
}

/* -------------------------------------------------------------------------- */
/* switching editors                                                           */
/* -------------------------------------------------------------------------- */

export type EditorMode = 'code' | 'rich';

/** Languages whose text is prose rather than code, so Markdown is a fair reading. */
const MARKDOWN_READABLE_LANGUAGES = new Set(['markdown']);

export type ConversionPlan =
    | { kind: 'lossless'; to: 'rich'; doc: JSONContent; markdownSource: string | null }
    | { kind: 'lossless'; to: 'code'; markdown: string }
    | { kind: 'lossy'; to: 'rich'; doc: JSONContent; issues: ConversionIssue[] }
    | { kind: 'lossy'; to: 'code'; markdown: string; issues: ConversionIssue[] }
    | {
        kind: 'choice';
        to: 'rich';
        /** Keeps every character and all whitespace, as one code block. */
        asCodeBlock: JSONContent;
        /** Reads the text as Markdown; may report issues. */
        asMarkdown: { doc: JSONContent; issues: ConversionIssue[] };
    };

export type ConversionRequest =
    | { from: 'code'; to: 'rich'; content: string; language: string | null }
    | { from: 'rich'; to: 'code'; doc: JSONContent };

/**
 * Decide what switching editors would do to the content, without doing it.
 *
 * - Rich -> code is Markdown serialization: lossless unless the document
 *   holds something Markdown cannot express.
 * - Code (Markdown) -> rich parses the Markdown; lossless unless it contains
 *   constructs the editor lacks.
 * - Code in any other language (including plain text or no language) is
 *   ambiguous: it can be kept verbatim as a code block, or read as Markdown.
 *   The author chooses.
 */
export function planConversion(request: ConversionRequest): ConversionPlan {
    if (request.from === 'rich') {
        const markdown = docToMarkdown(request.doc);
        const issues = checkDocStorable(request.doc);
        return issues.length
            ? { kind: 'lossy', to: 'code', markdown, issues }
            : { kind: 'lossless', to: 'code', markdown };
    }

    const { content, language } = request;

    if (content.trim() === '') {
        return { kind: 'lossless', to: 'rich', doc: emptyDoc(), markdownSource: null };
    }

    if (language && MARKDOWN_READABLE_LANGUAGES.has(language)) {
        const issues = checkMarkdownEditable(content);
        const { doc } = markdownToDoc(content);
        return issues.length
            ? { kind: 'lossy', to: 'rich', doc, issues }
            : { kind: 'lossless', to: 'rich', doc, markdownSource: content };
    }

    // Not declared Markdown: line breaks the author typed are meant literally.
    const parsed = markdownToDoc(content, { softBreaks: 'hard' });
    const storable = parsed.issues.length ? [] : checkDocStorable(parsed.doc);
    return {
        kind: 'choice',
        to: 'rich',
        asCodeBlock: codeBlockDoc(content, language && language !== 'text' ? language : null),
        asMarkdown: { doc: parsed.doc, issues: [...parsed.issues, ...storable] },
    };
}
