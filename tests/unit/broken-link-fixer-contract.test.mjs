import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const bl = await loadFlowModule('lib/utils/brokenLinks.js', 'broken-links');
const mod = readRepoFile('lib/modules/brokenLinkFixer.js');

test('a backslash-escaped markdown character is unescaped', () => {
	assert.equal(bl.fixHref('https://en.wikipedia.org/wiki/Foo\\_bar'), 'https://en.wikipedia.org/wiki/Foo_bar');
	assert.equal(bl.fixHref('https://example.com/a\\*b'), 'https://example.com/a*b');
	assert.equal(bl.fixHref('https://example.com/x\\(y\\)'), 'https://example.com/x(y)');
	assert.equal(bl.fixHref('/r/foo/comments/abc/some\\_title/'), '/r/foo/comments/abc/some_title/');
});

test('the percent-encoded form is unescaped too', () => {
	// reddit URL-encodes the destination after escaping it, so the backslash
	// arrives as %5C. A fixer that only handles the literal misses half of them.
	assert.equal(bl.fixHref('https://en.wikipedia.org/wiki/Foo%5C_bar'), 'https://en.wikipedia.org/wiki/Foo_bar');
	assert.equal(bl.fixHref('https://example.com/a%5c*b'), 'https://example.com/a*b');
});

test('a link that needs no repair returns null', () => {
	// Null rather than the unchanged string, so the caller can skip the DOM write
	// entirely and the guard attribute means something.
	assert.equal(bl.fixHref('https://example.com/normal_url'), null);
	assert.equal(bl.fixHref('/r/aww'), null);
	assert.equal(bl.fixHref(''), null);
	assert.equal(bl.fixHref(null), null);
	assert.equal(bl.fixHref(undefined), null);
});

test('script-bearing schemes are never rewritten', () => {
	// Rewriting one of these is how a link fixer becomes an XSS vector: the
	// blanket `href.replace(/\\/g, '')` the userscripts use will happily
	// normalise `java\script:` into something the browser executes.
	assert.equal(bl.fixHref('javascript:alert\\(1\\)'), null);
	assert.equal(bl.fixHref('  JavaScript:alert(1)'), null);
	assert.equal(bl.fixHref('data:text/html,\\<script\\>'), null);
	assert.equal(bl.fixHref('vbscript:msgbox\\(1\\)'), null);
});

test('a backslash that is not a markdown escape is left alone', () => {
	// The blanket `href.replace(/\\/g, '')` the userscripts use corrupts any URL
	// that legitimately carries a backslash — a search query for a Windows path
	// is the common case. Only a backslash in front of a character snudown would
	// have escaped is treated as an escape.
	assert.equal(bl.fixHref('https://example.com/search?q=C:%5CUsers'), null);
	assert.equal(bl.fixHref('https://example.com/a\\zb'), null, 'z is not escapable, so nothing should change');
	// …and the same URL with an escapable character after it still gets fixed,
	// so the rule above is a real discrimination rather than a blanket refusal.
	assert.equal(bl.fixHref('https://example.com/search?q=C:%5C_temp'), 'https://example.com/search?q=C:_temp');
});

test('isRedditHref recognises reddit and its media hosts only', () => {
	assert.equal(bl.isRedditHref('/r/aww'), true);
	assert.equal(bl.isRedditHref('https://old.reddit.com/r/aww'), true);
	assert.equal(bl.isRedditHref('https://reddit.com/r/aww'), true);
	assert.equal(bl.isRedditHref('https://i.redd.it/abc.jpg'), true);
	assert.equal(bl.isRedditHref('https://example.com/reddit.com'), false);
	// The classic suffix-match hole.
	assert.equal(bl.isRedditHref('https://notreddit.com/r/aww'), false);
	assert.equal(bl.isRedditHref('https://evil-reddit.com.attacker.test/'), false);
});

test('the module keeps a guard attribute so links are never rescanned', () => {
	assert.match(mod, /const ATTR = 'data-rsm-link-fixed'/);
	assert.match(mod, /hasAttribute\(ATTR\)/);
	assert.match(mod, /watchForElements\(/, 'new comments arrive after load and need repairing too');
});
