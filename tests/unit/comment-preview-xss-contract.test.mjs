// The wiki-TOC DOM-XSS guard, executed rather than pattern-matched.
//
// This contract used to assert that `lib/modules/commentPreview.js` *contained*
// the string `document.createElement('textarea')`. That proves the code is
// written; it cannot prove the code runs, that it decodes anything, or that it
// does not instantiate a live element — which is the entire security property.
// A regex-only contract of exactly this shape is how `eventTrackingSabotage`
// shipped a fetch blocker that blocked nothing.
//
// The decode step now lives in `lib/utils/html.js` as `decodeEntitiesAsText` so
// it can be called, and this file calls it against real attack strings in a real
// DOM.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/loadModule.mjs';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

installDom();
const { decodeEntitiesAsText, escapeHTML } = await loadFlowModule('lib/utils/html.js', 'comment-preview-xss');

test('entities are decoded to text', () => {
	assert.equal(decodeEntitiesAsText('&amp;'), '&');
	assert.equal(decodeEntitiesAsText('&lt;b&gt;'), '<b>');
	assert.equal(decodeEntitiesAsText('caf&eacute;'), 'café');
	assert.equal(decodeEntitiesAsText('plain heading'), 'plain heading');
});

test('empty and nullish input yield an empty string rather than throwing', () => {
	for (const input of ['', null, undefined]) {
		assert.equal(decodeEntitiesAsText(input), '');
	}
});

// The actual vulnerability. The input is `header.textContent`, so by the time it
// reaches the decoder it is *raw* markup as a string — snudown having rendered an
// escaped heading back to plain text. Feeding that to a live element's innerHTML
// re-parses it into real nodes.
//
// Getting this input shape wrong is easy and makes the test worthless: an
// entity-encoded string like `&lt;img&gt;` is harmless in a div too, because
// `innerHTML` resolves the character reference into a text node rather than a
// tag. Only the raw form distinguishes the two elements.
const ATTACKS = [
	'<img src=x onerror=alert(1)>',
	'<script>alert(1)</script>',
	'<svg onload=alert(1)>',
	'<iframe src=javascript:alert(1)>',
	// RCDATA is only ended by the matching close tag, so this is the one input
	// that could plausibly break out of a textarea.
	'</textarea><img src=x onerror=alert(1)>',
];

test('raw markup in a heading is preserved as text and never instantiated', () => {
	for (const attack of ATTACKS) {
		const before = document.querySelectorAll('img, script, svg, iframe').length;
		const decoded = decodeEntitiesAsText(attack);

		assert.equal(decoded, attack, `${attack} should come back unchanged, as text`);
		assert.equal(
			document.querySelectorAll('img, script, svg, iframe').length,
			before,
			`decoding ${attack} must not add live elements to the document`,
		);
	}
});

// The distinction the guard rests on, asserted directly. If someone ever swaps
// the element type back, this is the test that says why it matters.
test('the same string in a div does create a live element — which is why a textarea is used', () => {
	const div = document.createElement('div');
	div.innerHTML = '<img src=x onerror=alert(1)>';
	assert.equal(div.querySelectorAll('img').length, 1, 'a div parses raw markup into real elements — the original bug');

	const textarea = document.createElement('textarea');
	textarea.innerHTML = '<img src=x onerror=alert(1)>';
	assert.equal(textarea.querySelectorAll('img').length, 0, 'a textarea is RCDATA — no elements are created');
	assert.equal(textarea.value, '<img src=x onerror=alert(1)>', 'and the text is still available for building an id');
});

test('escapeHTML still escapes every character it claims to', () => {
	assert.equal(escapeHTML(`&"'<>/`), '&amp;&quot;&apos;&lt;&gt;&#47;');
	assert.equal(escapeHTML(''), '');
	assert.equal(escapeHTML(null), '');
});

// commentPreview must route through the helper rather than reintroducing its own
// decoder. This one assertion is deliberately source-level: it is a statement
// about wiring, not behaviour, and the behaviour is covered above.
test('commentPreview uses the shared helper and creates no decoder of its own', async () => {
	const { readRepoFile, codeOnly } = await import('./helpers/loadFlowModule.mjs');
	const raw = readRepoFile('lib/modules/commentPreview.js');
	const code = codeOnly(raw);

	assert.ok(raw.includes('decodeEntitiesAsText'), 'sanity: the helper name should appear in the file');
	assert.ok(code.includes('decodeEntitiesAsText('), 'commentPreview should call the shared helper');
	assert.ok(!/createElement\(['"]div['"]\)[\s\S]{0,80}innerHTML\s*=\s*contents/.test(code), 'no live-div decode may return');
});
