/**
 * Clean formatted content pasted from ChatGPT, Claude, Word or Google Docs.
 *
 * Pasted HTML is treated strictly as content. It is parsed with DOMParser into
 * an inert document -- no browsing context, so scripts never run and images,
 * frames and stylesheets are never fetched -- and reduced to plain structural
 * markup the editor understands. The editor's schema would drop unknown markup
 * anyway, but silently; doing it here first means we can count what did not
 * make it and tell the author, instead of an image quietly vanishing (or,
 * worse, being loaded from a third-party server the moment it is pasted).
 *
 * Images and attachments are out of scope for this version of the editor.
 */

import { isSafeUrl } from '@/lib/safe-url';

export interface DroppedContent {
    images: number;
    media: number;
    embeds: number;
    files: number;
    unsafeLinks: number;
}

export interface CleanedPaste {
    html: string;
    dropped: DroppedContent;
}

export function emptyDropped(): DroppedContent {
    return { images: 0, media: 0, embeds: 0, files: 0, unsafeLinks: 0 };
}

export function hasDropped(dropped: DroppedContent): boolean {
    return Object.values(dropped).some(count => count > 0);
}

export function mergeDropped(a: DroppedContent, b: DroppedContent): DroppedContent {
    return {
        images: a.images + b.images,
        media: a.media + b.media,
        embeds: a.embeds + b.embeds,
        files: a.files + b.files,
        unsafeLinks: a.unsafeLinks + b.unsafeLinks,
    };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One line per kind of content left out, for the notice under the toolbar. */
export function describeDropped(dropped: DroppedContent): string[] {
    const lines: string[] = [];
    if (dropped.images) lines.push(`${plural(dropped.images, 'image', 'images')} (images are not supported yet)`);
    if (dropped.files) lines.push(`${plural(dropped.files, 'file or attachment', 'files or attachments')} (attachments are not supported)`);
    if (dropped.media) lines.push(`${plural(dropped.media, 'audio or video element', 'audio or video elements')}`);
    if (dropped.embeds) lines.push(`${plural(dropped.embeds, 'embedded frame or object', 'embedded frames or objects')}`);
    if (dropped.unsafeLinks) lines.push(`${plural(dropped.unsafeLinks, 'link with an unsafe address', 'links with unsafe addresses')} (text kept, link removed)`);
    return lines;
}

/** Removed without comment: they are page machinery, not something the author meant to paste. */
const SILENT_REMOVE = 'script, noscript, style, link, meta, title, base, template, head, button, input, select, textarea, option, datalist, map, area';

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
    a: ['href', 'title'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align'],
    ol: ['start'],
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
};

export function cleanPastedHtml(html: string): CleanedPaste {
    const dropped = emptyDropped();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;

    removeComments(body);
    convertWordLists(doc, body);
    applyInlineStyles(doc, body);
    convertTaskLists(body);
    simplifyCodeBlocks(body);

    // Count what the author would have expected to see, then drop it.
    for (const element of Array.from(body.querySelectorAll('picture'))) {
        dropped.images += Math.max(1, element.querySelectorAll('img').length);
        element.remove();
    }
    for (const element of Array.from(body.querySelectorAll('img, svg'))) {
        dropped.images++;
        element.remove();
    }
    for (const element of Array.from(body.querySelectorAll('video, audio'))) {
        dropped.media++;
        element.remove();
    }
    for (const element of Array.from(body.querySelectorAll('iframe, object, embed, frame, frameset, applet, portal, canvas'))) {
        dropped.embeds++;
        element.remove();
    }
    for (const element of Array.from(body.querySelectorAll(SILENT_REMOVE))) {
        element.remove();
    }

    // Word's empty <o:p> placeholders carry nothing but non-breaking spaces.
    for (const element of Array.from(body.getElementsByTagName('o:p'))) {
        if (!element.textContent?.replace(/ /g, '').trim()) element.remove();
    }

    for (const element of Array.from(body.querySelectorAll('*'))) {
        const tag = element.tagName.toLowerCase();
        const allowed = ALLOWED_ATTRIBUTES[tag] ?? [];

        if (tag === 'a') {
            const href = element.getAttribute('href');
            if (href !== null && !isSafeUrl(href)) {
                dropped.unsafeLinks++;
                element.removeAttribute('href');
            }
        }

        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const keepLanguageClass = name === 'class' && (tag === 'code' || tag === 'pre');
            if (keepLanguageClass) {
                const language = attribute.value.split(/\s+/).find(cls => cls.startsWith('language-'));
                if (language) {
                    element.setAttribute('class', language);
                    continue;
                }
            }
            if (!allowed.includes(name)) element.removeAttribute(attribute.name);
        }
    }

    return { html: body.innerHTML, dropped };
}

function removeComments(root: Node): void {
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === 8) {
            child.parentNode?.removeChild(child);
        } else {
            removeComments(child);
        }
    }
}

function unwrap(element: Element): void {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
}

function styleOf(element: Element): string {
    return (element.getAttribute('style') ?? '').toLowerCase();
}

/**
 * Word and Google Docs express bold, italic and strikethrough as CSS rather than
 * tags. Style attributes are removed below, so the formatting is turned into
 * the equivalent tags first.
 */
function applyInlineStyles(doc: Document, root: Element): void {
    for (const element of Array.from(root.querySelectorAll('[style]'))) {
        const style = styleOf(element);
        const tag = element.tagName.toLowerCase();

        // Google Docs wraps an entire paste in <b style="font-weight:normal">.
        if (tag === 'b' && /font-weight:\s*(normal|400)/.test(style)) {
            unwrap(element);
            continue;
        }

        if ((tag === 'td' || tag === 'th') && !element.hasAttribute('align')) {
            const align = style.match(/text-align:\s*(left|center|right)/)?.[1];
            if (align) element.setAttribute('align', align);
        }

        const wrappers: string[] = [];
        if (/font-weight:\s*(bold|bolder|[6-9]00)/.test(style)) wrappers.push('strong');
        if (/font-style:\s*italic/.test(style)) wrappers.push('em');
        if (/text-decoration[^;]*line-through/.test(style)) wrappers.push('s');
        if (!wrappers.length) continue;

        for (const wrapperTag of wrappers) {
            const wrapper = doc.createElement(wrapperTag);
            while (element.firstChild) wrapper.appendChild(element.firstChild);
            element.appendChild(wrapper);
        }
    }
}

const WORD_LIST_STYLE = /mso-list:\s*l(\d+)\s+level(\d+)/i;

function wordListInfo(element: Element | null): { list: string; level: number } | null {
    if (!element || element.tagName.toLowerCase() !== 'p') return null;
    const match = (element.getAttribute('style') ?? '').match(WORD_LIST_STYLE);
    return match ? { list: match[1], level: Number(match[2]) } : null;
}

/**
 * Word does not paste lists as lists. Each item is a paragraph with a
 * `mso-list:l0 level2` style and its bullet or number typed out in a span
 * marked `mso-list:Ignore`. Rebuild real, nested <ul>/<ol> from that.
 */
function convertWordLists(doc: Document, root: Element): void {
    for (const paragraph of Array.from(root.querySelectorAll('p'))) {
        if (!paragraph.isConnected || !wordListInfo(paragraph)) continue;

        const group: Element[] = [paragraph];
        let next = paragraph.nextElementSibling;
        while (next && wordListInfo(next)) {
            group.push(next);
            next = next.nextElementSibling;
        }

        const items = group.map(element => {
            const info = wordListInfo(element)!;
            const markerSpan = Array.from(element.querySelectorAll('span'))
                .find(span => /mso-list:\s*ignore/i.test(span.getAttribute('style') ?? ''));
            const marker = (markerSpan?.textContent ?? '').replace(/ /g, ' ').trim();
            markerSpan?.remove();
            const ordered = /^(\d+|[a-z]|[ivxlcdm]+)[.)]$/i.test(marker);
            return { element, level: info.level, ordered };
        });

        const rootList = doc.createElement(items[0].ordered ? 'ol' : 'ul');
        const stack: { list: Element; level: number }[] = [{ list: rootList, level: items[0].level }];

        for (const item of items) {
            while (stack.length > 1 && stack[stack.length - 1].level > item.level) stack.pop();

            let top = stack[stack.length - 1];
            if (item.level > top.level) {
                let parentItem = top.list.lastElementChild;
                if (!parentItem) {
                    parentItem = doc.createElement('li');
                    top.list.appendChild(parentItem);
                }
                const nested = doc.createElement(item.ordered ? 'ol' : 'ul');
                parentItem.appendChild(nested);
                top = { list: nested, level: item.level };
                stack.push(top);
            }

            const li = doc.createElement('li');
            const content = doc.createElement('p');
            while (item.element.firstChild) content.appendChild(item.element.firstChild);
            li.appendChild(content);
            top.list.appendChild(li);
        }

        paragraph.replaceWith(rootList);
        group.slice(1).forEach(element => element.remove());
    }
}

/**
 * Rendered Markdown (ChatGPT, GitHub) shows checklists as list items with a
 * disabled checkbox. The editor's checklist markup is `data-type` based; the
 * checkbox inputs themselves are removed with the other form controls.
 */
function convertTaskLists(root: Element): void {
    for (const input of Array.from(root.querySelectorAll('li input[type="checkbox"]'))) {
        const item = input.closest('li');
        const list = item?.parentElement;
        if (!item || !list || list.tagName.toLowerCase() !== 'ul') continue;

        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', input.hasAttribute('checked') ? 'true' : 'false');
        list.setAttribute('data-type', 'taskList');
        input.remove();
    }
}

/**
 * Assistant UIs put a language label and a "Copy code" button inside the <pre>
 * of every code block. Only the <code> element is content.
 */
function simplifyCodeBlocks(root: Element): void {
    for (const pre of Array.from(root.querySelectorAll('pre'))) {
        const code = pre.querySelector('code');
        if (code && (pre.childNodes.length !== 1 || pre.firstChild !== code)) {
            pre.replaceChildren(code);
        }
    }
}
