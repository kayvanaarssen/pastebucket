// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownPreview } from './MarkdownPreview';

const hostile = [
    '# Offer',
    '<script>alert(document.cookie)</script>',
    '<img src="x" onerror="alert(1)"> <b onclick="alert(2)">bold</b>',
    '[click me](javascript:alert(3)) [data](data:text/html;base64,PHNjcmlwdD4=) [vb](vbscript:msgbox(1)) [ok](https://example.com/offer)',
    '![tracking pixel](https://tracker.example/pixel.gif)',
    '<iframe src="https://evil.example"></iframe>',
    '- [x] done',
    '',
    '```js',
    'const html = "<script>";',
    '```',
].join('\n\n');

/** Parse the markup as a browser would and inspect elements and attributes, not text. */
function render(variant?: 'preview' | 'document') {
    const html = renderToStaticMarkup(<MarkdownPreview content={hostile} variant={variant} />);
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    const elements = Array.from(body.querySelectorAll('*'));
    const attributes = elements.flatMap(element => Array.from(element.attributes).map(attribute => attribute));
    return { html, body, elements, attributes };
}

function expectNothingExecutable({ elements, attributes }: ReturnType<typeof render>) {
    const tags = elements.map(element => element.tagName.toLowerCase());
    expect(tags).not.toContain('script');
    expect(tags).not.toContain('iframe');
    expect(attributes.filter(attribute => attribute.name.startsWith('on'))).toEqual([]);
    for (const attribute of attributes.filter(a => a.name === 'href' || a.name === 'src')) {
        expect(attribute.value).not.toMatch(/^\s*(javascript|vbscript|data):/i);
    }
}

describe('MarkdownPreview', () => {
    test('document variant renders no executable markup and loads nothing', () => {
        const rendered = render('document');
        const { body, html } = rendered;

        expectNothingExecutable(rendered);
        // No image element, and no preload hint React would hoist for one.
        expect(body.querySelector('img')).toBeNull();
        expect(html).not.toContain('rel="preload"');

        const placeholder = Array.from(body.querySelectorAll('a')).find(a => a.textContent?.includes('(not loaded)'));
        expect(placeholder?.textContent).toBe('Image: tracking pixel (not loaded)');
        expect(placeholder?.getAttribute('href')).toBe('https://tracker.example/pixel.gif');

        // Raw HTML stays visible as text instead of silently disappearing.
        expect(body.textContent).toContain('<script>alert(document.cookie)</script>');

        const ok = body.querySelector('a[href="https://example.com/offer"]');
        expect(ok?.getAttribute('target')).toBe('_blank');
        expect(ok?.getAttribute('rel')).toBe('noopener noreferrer nofollow');

        const checkbox = body.querySelector('input[type="checkbox"]');
        expect(checkbox?.hasAttribute('disabled')).toBe(true);
        expect(body.querySelector('pre code')?.textContent?.trim()).toBe('const html = "<script>";');
        expect(body.querySelector('button[title="Copy code"]')).not.toBeNull();
    });

    test('preview variant keeps its existing rendering', () => {
        const rendered = render();
        const { body } = rendered;

        expectNothingExecutable(rendered);
        expect(body.querySelector('div')?.getAttribute('class')).toBe('prose prose-sm dark:prose-invert max-w-none p-4 sm:p-6');
        expect(body.querySelector('a[href="https://example.com/offer"]')?.getAttribute('rel')).toBe('noopener noreferrer');
        // Unchanged behaviour: the preview still renders Markdown images.
        expect(body.querySelector('img')?.getAttribute('src')).toBe('https://tracker.example/pixel.gif');
    });
});
