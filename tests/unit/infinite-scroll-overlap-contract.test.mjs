import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';

// Reddit's `after` cursor overlaps. Consecutive listing pages routinely share
// rows, and a post that moves up between two fetches is served twice. The
// watcher-level dedupe removes a repeat, but only once it has been fetched,
// parsed, inserted and registered — and the page divider was emitted whether or
// not anything new arrived, so a page of pure overlap drew a separator with
// nothing under it.

installDom({ url: 'https://old.reddit.com/r/example/' });

const mod = await loadModule('lib/modules/infiniteScroll.js', 'infinite-scroll-overlap', { dom: false });
const { loadNextPage, isLinkFullname, seenFullnames } = mod;

function row(fullname, title = fullname || 'untitled') {
	const attr = fullname === null ? '' : ` data-fullname="${fullname}"`;
	return `<div class="thing"${attr}><a class="title">${title}</a></div>`;
}

function page(rows, next) {
	const nextLink = next ? `<span class="next-button"><a href="${next}">next</a></span>` : '';
	return `<!doctype html><html><body><div class="sitetable linklisting">${rows.join('')}</div>${nextLink}</body></html>`;
}

function listing() {
	return document.querySelector('.sitetable.linklisting');
}

function fullnamesOnPage() {
	return Array.from(listing().querySelectorAll('.thing')).map(t => t.getAttribute('data-fullname'));
}

// The empty-page chain is scheduled with `setTimeout(..., 0)`, so a test has to
// let those turns run. Generous enough for three of them.
function settleChain() {
	return new Promise(resolve => { setTimeout(resolve, 120); });
}

let servedCount = 0;
function served() {
	return servedCount;
}

function dividers() {
	return listing().querySelectorAll('.res-slim-infinite-divider').length;
}

// Armed the way the page arms it: `contentStart` reads the listing's own next
// link. A test-only setter for `nextUrl` would prove the append loop works when
// handed a URL the product never hands it.
function startListing(existing, pages) {
	mod._resetForTest();
	mod.module.options.enabled.value = true;
	mod.module.options.pause.value = false;

	document.body.innerHTML =
		`<div class="sitetable linklisting">${existing.join('')}</div>` +
		'<span class="next-button"><a href="https://old.reddit.com/?count=25&amp;after=t3_seed">next</a></span>';

	// A reddit URL takes `ajax`'s same-origin branch, which goes through the
	// global `fetch` rather than the extension's background proxy — so this is
	// the hook that controls the response, not `__resSlimAjax`.
	// A real `Response`, not a hand-rolled shape: `ajax` reads more of it than the
	// obvious `text()`, and a partial stand-in returns an empty body through a
	// path that then reports success.
	const served = [...pages];
	servedCount = 0;
	globalThis.__fetchHook = () => {
		servedCount += 1;
		const next = served.shift();
		if (!next) return Promise.reject(new Error('the module asked for more pages than the test serves'));
		return Promise.resolve(new Response(next, { status: 200, headers: { 'content-type': 'text/html' } }));
	};

	mod.module.contentStart();
}

test('a link fullname is a post id, not any thing id', () => {
	assert.equal(isLinkFullname('t3_1w0mfi4'), true);
	assert.equal(isLinkFullname('t3_abc123'), true);
	// A comment id must not be able to collide with a post id in the same set.
	assert.equal(isLinkFullname('t1_abc123'), false);
	assert.equal(isLinkFullname('t3_'), false, 'a prefix with no id is not an id');
	assert.equal(isLinkFullname('t3_not valid'), false);
	assert.equal(isLinkFullname(''), false);
	assert.equal(isLinkFullname(null), false);
	// The width test this shares its shape with stopped matching once reddit's id
	// counter passed six characters, which switched the dedupe off site-wide.
	assert.equal(isLinkFullname('t3_1234567'), true, 'a seven-character id is a current post id');
});

test('the seed set reads the page rather than trusting module state', () => {
	document.body.innerHTML = `<div class="sitetable linklisting">${row('t3_aaa') + row('t3_bbb') + row(null) + row('t1_ccc')}</div>`;
	assert.deepEqual([...seenFullnames(listing())].sort(), ['t3_aaa', 't3_bbb'], 'only valid post ids seed the set');

	// A row removed by a filter after load must not keep blocking its own fullname.
	listing().querySelector('[data-fullname="t3_aaa"]').remove();
	assert.deepEqual([...seenFullnames(listing())], ['t3_bbb']);
});

test('three overlapping pages leave each post on the page exactly once', async () => {
	// Page 1 repeats p2 (the cursor overlap), page 2 repeats p3 and p4 (posts that
	// moved up between fetches), page 3 is entirely rows already present.
	startListing([row('t3_p1'), row('t3_p2')], [
		page([row('t3_p2'), row('t3_p3'), row('t3_p4')], 'https://old.reddit.com/?count=50&after=t3_p4'),
		page([row('t3_p3'), row('t3_p4'), row('t3_p5')], 'https://old.reddit.com/?count=75&after=t3_p5'),
		page([row('t3_p4'), row('t3_p5')], 'https://old.reddit.com/?count=100&after=t3_p5'),
	]);

	await loadNextPage();
	await loadNextPage();
	await loadNextPage();

	const names = fullnamesOnPage();
	assert.deepEqual(names, ['t3_p1', 't3_p2', 't3_p3', 't3_p4', 't3_p5'], 'every post appears once, in order');
	assert.equal(new Set(names).size, names.length);
});

test('a page that adds nothing emits no divider', async () => {
	startListing([row('t3_p1'), row('t3_p2')], [
		page([row('t3_p2'), row('t3_p3')], 'https://old.reddit.com/?count=50&after=t3_p3'),
		// Pure overlap: everything here is already on the page.
		page([row('t3_p2'), row('t3_p3')], 'https://old.reddit.com/?count=75&after=t3_p3'),
	]);

	await loadNextPage();
	assert.equal(dividers(), 1, 'a page that added a post gets its separator');

	await loadNextPage();
	assert.equal(dividers(), 1, 'a page that added nothing must not draw a separator over empty space');
	assert.deepEqual(fullnamesOnPage(), ['t3_p1', 't3_p2', 't3_p3']);
});

// --- a page that adds nothing has to keep the scroll alive --------------------
//
// Skipping every overlapping row means a page of pure overlap changes the DOM
// by nothing at all. The only thing that asks for another page is the sentinel
// observer, and an `IntersectionObserver` fires on intersection *transitions* —
// with the sentinel already inside the 800px root margin and the geometry
// unchanged, no further callback arrives. The scroll would simply stop, with
// `stopped` false and `nextUrl` advanced, until the reader scrolled it out and
// back.

test('a page of pure overlap fetches the next one without waiting for a scroll', async () => {
	startListing([row('t3_p1')], [
		page([row('t3_p1')], 'https://old.reddit.com/?count=50&after=t3_p1'),
		page([row('t3_p1')], 'https://old.reddit.com/?count=75&after=t3_p1'),
		page([row('t3_p2')], 'https://old.reddit.com/?count=100&after=t3_p2'),
	]);

	// One call from the sentinel. The two empty pages have to be walked through
	// on their own for the third to arrive.
	await loadNextPage();
	await settleChain();

	assert.deepEqual(fullnamesOnPage(), ['t3_p1', 't3_p2'], 'the next real post has to arrive without a second scroll');
	assert.equal(dividers(), 1, 'and only the page that added something draws a separator');
});

test('a run of empty pages is bounded rather than walking to the pagination ceiling', async () => {
	// Reddit paginates to a thousand items. A listing that has genuinely run out
	// of new posts must not be walked end to end as fast as the rate limiter
	// allows.
	const overlap = () => page([row('t3_p1')], 'https://old.reddit.com/?count=x&after=t3_p1');
	startListing([row('t3_p1')], [overlap(), overlap(), overlap(), overlap(), overlap(), overlap()]);

	await loadNextPage();
	await settleChain();

	// The first load plus the bounded chain, and no further.
	assert.ok(served() <= 4, `expected the chain to stop, ${served()} pages were fetched`);
	assert.deepEqual(fullnamesOnPage(), ['t3_p1']);
});

test('rows with no usable fullname are kept, not dropped as duplicates', async () => {
	// A placeholder, a deleted post and an ad all reach the listing without a
	// comparable id, and two of them look identical to each other. Keeping unique
	// content matters more than being clever about ids that do not exist.
	startListing([row('t3_p1')], [
		page([row('t3_p1'), row(null, 'promoted'), row(null, 'deleted'), row('t3_p2')]),
	]);

	await loadNextPage();

	const titles = Array.from(listing().querySelectorAll('.thing .title')).map(a => a.textContent);
	assert.deepEqual(titles, ['t3_p1', 'promoted', 'deleted', 't3_p2']);
	assert.equal(dividers(), 1, 'the page did add rows, so it gets a separator');
});
