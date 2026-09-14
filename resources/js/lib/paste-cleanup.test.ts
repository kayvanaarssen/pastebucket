// @vitest-environment happy-dom
// happy-dom, unlike a browser, fetches <link> and <script> resources even in
// DOMParser documents. Browsers never do (such documents have no browsing
// context), so loading is switched off to keep the tests off the network.
// @vitest-environment-options {"settings": {"disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableJavaScriptEvaluation": true}}
import { describe, expect, test } from 'vitest';
import { cleanPastedHtml, describeDropped, hasDropped } from './paste-cleanup';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body;

describe('cleanPastedHtml', () => {
    test('keeps the structure of an assistant answer', () => {
        const { html, dropped } = cleanPastedHtml(`
            <h2 data-start="1" class="text-xl">Plan</h2>
            <p>Use <strong>bold</strong>, <em>italic</em> and <code>inline</code>.</p>
            <ol start="3"><li><p>three</p><ul><li>nested</li></ul></li></ol>
            <pre class="overflow-auto"><div class="header">python<button>Copy code</button></div><div><code class="hljs language-python">def f():
\treturn  1
</code></div></pre>
            <table><thead><tr><th style="text-align:right">Qty</th></tr></thead><tbody><tr><td>3</td></tr></tbody></table>
        `);
        const body = parse(html);

        expect(hasDropped(dropped)).toBe(false);
        expect(body.querySelector('h2')?.getAttribute('class')).toBeNull();
        expect(body.querySelector('ol')?.getAttribute('start')).toBe('3');
        expect(body.querySelector('ol ul li')?.textContent).toBe('nested');
        // Only the <code> survives inside <pre>: no "python" label, no button text.
        const pre = body.querySelector('pre')!;
        expect(pre.textContent).toBe('def f():\n\treturn  1\n');
        expect(pre.querySelector('code')?.getAttribute('class')).toBe('language-python');
        expect(body.querySelector('th')?.getAttribute('align')).toBe('right');
        expect(html).not.toContain('style=');
    });

    test('removes scripts, handlers and unsafe links, and counts what the author would miss', () => {
        const { html, dropped } = cleanPastedHtml(`
            <p onclick="steal()">Hello <img src="https://tracker.example/pixel.gif" onerror="alert(1)"></p>
            <script>alert(1)</script><style>p{color:red}</style>
            <picture><source srcset="x.webp"><img src="x.png"></picture>
            <iframe src="https://evil.example"></iframe><object data="x.swf"></object>
            <video src="clip.mp4"></video><svg><circle r="4"/></svg>
            <a href="javascript:alert(1)">bad link</a> <a href="https://example.com" target="_blank" rel="opener">good</a>
            <a href=" java\tscript:alert(1)">tabbed</a>
        `);

        expect(html).not.toMatch(/<script|<style|<img|<iframe|<object|<video|<svg|onclick|onerror|javascript:|target=|rel=/i);
        expect(html).toContain('Hello');
        expect(html).toContain('bad link');
        expect(html).toContain('href="https://example.com"');
        expect(dropped).toEqual({ images: 3, media: 1, embeds: 2, files: 0, unsafeLinks: 2 });
        expect(describeDropped(dropped)[0]).toBe('3 images (images are not supported yet)');
    });

    test('rebuilds nested Word lists from mso-list paragraphs', () => {
        const word = `
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>First <b>bold</b><o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>Nested<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp; </span></span><![endif]>Second<o:p></o:p></p>
<p class=MsoNormal>Between</p>
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span>Numbered</p>
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span>Numbered two</p>`;

        const body = parse(cleanPastedHtml(word).html);
        const lists = body.querySelectorAll(':scope > ul, :scope > ol');

        expect(lists).toHaveLength(2);
        expect(lists[0].tagName).toBe('UL');
        expect(lists[0].children).toHaveLength(2);
        expect(lists[0].querySelector('li > ul > li')?.textContent?.trim()).toBe('Nested');
        expect(lists[0].querySelector('b, strong')?.textContent).toBe('bold');
        expect(lists[0].textContent).not.toContain('·');
        expect(lists[1].tagName).toBe('OL');
        expect(Array.from(lists[1].children).map(li => li.textContent?.trim())).toEqual(['Numbered', 'Numbered two']);
        expect(body.textContent).toContain('Between');
    });

    test('Google Docs: the bold wrapper is dropped, styled spans become tags', () => {
        const { html } = cleanPastedHtml(
            '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Heavy</span> '
            + '<span style="font-style:italic">slanted</span> <span style="text-decoration:line-through">gone</span> plain</p></b>',
        );
        const body = parse(html);

        expect(body.querySelector('b')).toBeNull();
        expect(body.querySelector('strong')?.textContent).toBe('Heavy');
        expect(body.querySelector('em')?.textContent).toBe('slanted');
        expect(body.querySelector('s')?.textContent).toBe('gone');
        expect(html).not.toContain('docs-internal-guid');
    });

    test('rendered GitHub-style checklists become editor checklists', () => {
        const { html } = cleanPastedHtml(
            '<ul class="contains-task-list"><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox" disabled> todo</li></ul>',
        );
        const body = parse(html);

        expect(body.querySelector('ul')?.getAttribute('data-type')).toBe('taskList');
        expect(Array.from(body.querySelectorAll('li')).map(li => li.getAttribute('data-checked'))).toEqual(['true', 'false']);
        expect(body.querySelector('input')).toBeNull();
    });
});
