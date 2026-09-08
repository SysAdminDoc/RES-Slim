// The second layer under the comment preview, tested with the output a
// *regressed* renderer would produce.
//
// This is the only honest way to test it. snudown escapes every dangerous
// construct tried against the shipped build on 2026-09-08 -- `<img src=x
// onerror=…>`, a `javascript:` link, a `<script>`, an inline handler, an
// `<iframe>`, an `<svg><animate onbegin=…>` -- so nothing the preview currently
// renders is changed by the sanitizer in any way that matters, and a test that
// fed it markdown could not fail if the sanitizer were deleted.
//
// So the renderer's output is supplied directly. What is asserted is what the
// layer does to HTML that has already gone wrong, plus the two links in the
// chain that put it there.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';
import { readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/comments/a/b/' });

const { sanitizePreviewHtml } = await loadModule('lib/utils/previewHtml.js', 'preview-sanitize', { dom: false });

// What is in the preview when it lands, rather than what the string looks like.
function rendered(html) {
	const host = document.createElement('div');
	host.innerHTML = sanitizePreviewHtml(html);
	return {
		handlers: [...new Set([...host.querySelectorAll('*')]
			.flatMap(node => [...node.attributes].map(attribute => attribute.name))
			.filter(name => name.startsWith('on')))],
		scripts: host.querySelectorAll('script').length,
		iframes: host.querySelectorAll('iframe').length,
		hrefs: [...host.querySelectorAll('a')].map(anchor => anchor.getAttribute('href') || ''),
		html: host.innerHTML,
		text: host.textContent,
	};
}

test('a handler the renderer let through does not reach the preview', () => {
	const out = rendered('<p>hello <img src="x" onerror="window.pwned = true"> there</p>');
	assert.deepEqual(out.handlers, [], `an event handler survived: ${out.html}`);
	// The image itself is fine and stays; only the handler goes.
	assert.match(out.text, /hello/);
});

test('a script, an iframe and a javascript link do not reach it either', () => {
	const script = rendered('<p>a</p><script>window.pwned = true</script>');
	assert.equal(script.scripts, 0, `a script element survived: ${script.html}`);

	const frame = rendered('<iframe src="https://evil.test"></iframe>');
	assert.equal(frame.iframes, 0, `an iframe survived: ${frame.html}`);

	const link = rendered(`<a href="${'javascript'}:window.pwned = true">click</a>`);
	assert.deepEqual(link.hrefs.filter(href => href.toLowerCase().startsWith(`javascript${':'}`)), [],
		`a script URL survived: ${link.html}`);
	// The anchor is kept, without its destination, rather than the text vanishing.
	assert.match(link.text, /click/);
});

test('everything the preview exists to render survives', () => {
	// A sanitizer that strips too much is a broken preview, and this preview
	// carries reddit's own dialect: spoilers, superscript, tables, fenced code
	// with highlight classes, and the wiki table of contents with its anchors.
	const keep = [
		['a spoiler', '<span class="md-spoiler-text">secret</span>', 'span.md-spoiler-text'],
		['superscript', '<sup>high</sup>', 'sup'],
		['a table', '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>', 'table td'],
		['fenced code', '<pre><code class="language-js"><span class="hljs-keyword">const</span></code></pre>', 'pre code .hljs-keyword'],
		['a wiki anchor', '<h2 id="wiki_section">S</h2>', 'h2#wiki_section'],
		['the toc list', '<div class="toc"><ul data-level="1"><li><a href="#wiki_section">S</a></li></ul></div>', '.toc ul[data-level="1"] a'],
		['a plain link', '<a href="/r/example">r/example</a>', 'a[href="/r/example"]'],
		['an image', '<img src="https://b.thumbs.redditmedia.com/x.png" alt="e">', 'img[src]'],
	];

	for (const [what, html, selector] of keep) {
		const host = document.createElement('div');
		host.innerHTML = sanitizePreviewHtml(html);
		assert.ok(host.querySelector(selector), `${what} was stripped: ${host.innerHTML}`);
	}
});

test('the preview writes what the sanitizer returned, on both of its paths', () => {
	// The layer only matters if it is in the way. `markdownToHTML` has two
	// returns -- the ordinary one and the wiki one -- and each is a separate
	// chance to write the renderer's output straight through.
	const code = codeOnly(readRepoFile('lib/modules/commentPreview.js'));

	const body = code.slice(code.indexOf('async function markdownToHTML('), code.indexOf('const addBigEditorButton'));
	const returns = [...body.matchAll(/\n\t*return ([^\n]+);/g)].map(match => match[1]);
	assert.ok(returns.length >= 2, `expected both render paths, found ${JSON.stringify(returns)}`);
	for (const statement of returns) {
		assert.match(statement, /^sanitizePreviewHtml\(/, `a render path returns unsanitized HTML: ${statement}`);
	}

	assert.match(code, /import \{ sanitizePreviewHtml \} from '\.\.\/utils\/previewHtml'/);
});
