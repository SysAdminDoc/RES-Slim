import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const vp = await loadFlowModule('lib/utils/visitedPosts.js', 'visited-posts');
const mod = readRepoFile('lib/modules/visitedPosts.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 6);

test('a comments URL yields the post fullname', () => {
	assert.equal(vp.fullnameFromCommentsUrl('/r/aww/comments/1abcde/a_cat/'), 't3_1abcde');
	assert.equal(vp.fullnameFromCommentsUrl('https://old.reddit.com/r/aww/comments/1abcde/'), 't3_1abcde');
	// The permalink of a single comment still identifies the post.
	assert.equal(vp.fullnameFromCommentsUrl('/r/aww/comments/1abcde/a_cat/h9xyz/'), 't3_1abcde');
});

test('a non-post URL yields nothing', () => {
	assert.equal(vp.fullnameFromCommentsUrl('/r/aww/'), null);
	assert.equal(vp.fullnameFromCommentsUrl('/user/someone/comments/'), null);
	assert.equal(vp.fullnameFromCommentsUrl(''), null);
	assert.equal(vp.fullnameFromCommentsUrl(null), null);
});

test('only real post fullnames are stored', () => {
	// Storing a comment or a subreddit fullname would make the listing pass mark
	// the wrong rows.
	assert.equal(vp.isPostFullname('t3_1abcde'), true);
	assert.equal(vp.isPostFullname('t1_1abcde'), false);
	assert.equal(vp.isPostFullname('t5_aww'), false);
	assert.equal(vp.isPostFullname('t3_'), false);
	assert.equal(vp.isPostFullname(null), false);

	assert.deepEqual(vp.markVisited({}, 't1_x', NOW), {}, 'a comment fullname must be rejected, not stored');
	assert.deepEqual(vp.markVisited({}, 't3_x', NOW), { t3_x: NOW });
});

test('isVisited does not confuse inherited object properties for entries', () => {
	// A bare `map[key]` lookup answers true for "constructor", "toString" and
	// friends — which would mark random posts as read.
	assert.equal(vp.isVisited({}, 't3_constructor'), false);
	assert.equal(vp.isVisited({}, 'constructor'), false);
	assert.equal(vp.isVisited({ t3_a: NOW }, 't3_a'), true);
	assert.equal(vp.isVisited({ t3_a: NOW }, 't3_b'), false);
});

test('pruning drops entries past the expiry and keeps the rest', () => {
	const map = {
		t3_old: NOW - 200 * DAY,
		t3_edge: NOW - 90 * DAY,
		t3_new: NOW - 1 * DAY,
	};
	const { map: pruned, removed } = vp.pruneVisited(map, 90, NOW);
	assert.equal(removed, 1);
	assert.deepEqual(Object.keys(pruned).sort(), ['t3_edge', 't3_new']);
});

test('an invalid expiry falls back to the default rather than wiping the store', () => {
	const map = { t3_a: NOW - 10 * DAY };
	assert.equal(vp.pruneVisited(map, NaN, NOW).removed, 0);
	assert.equal(vp.pruneVisited(map, 0, NOW).removed, 0);
	assert.equal(vp.pruneVisited(map, -5, NOW).removed, 0);
	assert.equal(vp.DEFAULT_EXPIRE_DAYS, 90);
});

test('non-numeric values are treated as expired', () => {
	const { map, removed } = vp.pruneVisited({ t3_a: 'yesterday', t3_b: NOW }, 90, NOW);
	assert.equal(removed, 1);
	assert.deepEqual(Object.keys(map), ['t3_b']);
});

test('the module registers its watcher before awaiting storage', () => {
	// watchForThings appends to a list and never replays, and the things already
	// on the page are walked once during contentStart — so registering after an
	// await misses every post that was there on load. A repo-wide contract test
	// enforces the shape; this one pins the queue that makes it correct.
	const start = mod.indexOf('module.contentStart');
	const watchAt = mod.indexOf('watchForThings', start);
	const getAllAt = mod.indexOf('store.getAll()', start);
	assert.ok(watchAt > 0 && getAllAt > watchAt, 'watchForThings must be registered before the store read');
	assert.match(mod, /pending\.push\(thing\)/, 'things arriving before the store loads must be queued, not dropped');
	assert.match(mod, /while \(pending\.length\) decorate/);
});

test('the module asks for no browsing-history permission', () => {
	// The whole point of the local store: the comparable userscripts request the
	// `history` permission to read visited state back out of the browser.
	assert.doesNotMatch(mod, /chrome\.history|browser\.history|permissions.*history/);
	assert.match(mod, /module\.disabledByDefault = true/);
});

// The keyboard half. `mousedown` fires for the middle click and the ctrl-click
// as well as the ordinary one, so those were always covered; pressing Enter on a
// focused link fires no pointer event at all, so a keyboard user's opened posts
// were never recorded and the module did nothing for them.
//
// Executed against real elements rather than asserted from source: the decision
// is `fullnameFromActivation`, and both listeners reach it.
test('an activation on a comments link resolves the post, wherever it landed', () => {
	const dom = new JSDOM('<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body>' +
		'<div class="thing" data-fullname="t3_1abcde">' +
		'<a class="title" href="https://example.org/story">Title</a>' +
		'<a class="comments" href="/r/aww/comments/1abcde/a_cat/"><span id="inner">24 comments</span></a>' +
		'</div>' +
		'<a class="title" href="https://example.org/loose">Outside any row</a>' +
		'</body></html>');
	const { document } = dom.window;

	// The comments link, and a span inside it — a real Enter press targets
	// whatever has focus, and `closest` is what walks back up to the anchor.
	assert.equal(vp.fullnameFromActivation(document.querySelector('a.comments')), 't3_1abcde');
	assert.equal(vp.fullnameFromActivation(document.querySelector('#inner')), 't3_1abcde');

	// A title link inside a row means the row's own post, taken from the row.
	assert.equal(vp.fullnameFromActivation(document.querySelector('.thing a.title')), 't3_1abcde');

	// A title link with no row above it resolves to nothing rather than throwing.
	assert.equal(vp.fullnameFromActivation(document.querySelector('body > a.title')), null);
	// So does an element that is not in a link at all.
	assert.equal(vp.fullnameFromActivation(document.querySelector('body')), null);
	assert.equal(vp.fullnameFromActivation(null), null);
});

test('both the pointer and the keyboard path reach the same resolver', () => {
	// Two listeners, one decision. If a future edit inlines the logic back into
	// one of them the other silently stops agreeing with it.
	assert.match(mod, /document\.addEventListener\('mousedown'/);
	assert.match(mod, /document\.addEventListener\('keydown'/);
	assert.equal((mod.match(/rememberFromEventTarget\(e\.target\)/g) || []).length, 2);
	// Enter only, and not while the reader is holding a modifier that means
	// something else. Space scrolls a page, it does not activate a link.
	assert.match(mod, /if \(e\.key !== 'Enter' \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/);
});
