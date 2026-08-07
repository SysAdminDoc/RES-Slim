// Executing contracts for four of the inherited modules that had no test.
//
// These are the ones the README lists first as the product's reason to exist,
// and coverage had been tracking modules added since v0.10 instead. Each is
// exercised through the real registry so option gating and page-type gating are
// the product's own, not a reimplementation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom();

const NewCommentCount = await loadModule('lib/modules/newCommentCount.js', 'inherited-modules');
const registry = NewCommentCount.__registry;
const InfiniteScroll = await loadModule('lib/modules/infiniteScroll.js', 'inherited-infinite');
const mod = id => registry.getUnchecked(id);

function withOption(module, key, value, fn) {
	const previous = module.options[key].value;
	module.options[key].value = value;
	try {
		return fn();
	} finally {
		module.options[key].value = previous;
	}
}

// A minimal stand-in for a listing row. `getNewCount` only reaches for the
// fullname and the comment count, so this is the whole surface it touches.
function fakeThing({ fullname = 't3_abc123', commentCount = 10 } = {}) {
	const element = document.createElement('div');
	element.className = 'thing link';
	element.dataset.fullname = fullname;
	document.body.append(element);

	return {
		element,
		getFullname: () => fullname,
		getCommentCount: () => commentCount,
		getCommentCountElement: () => null,
	};
}

// --- version ---------------------------------------------------------------

test('version is always enabled and hidden from the module list', () => {
	const version = mod('version');

	assert.equal(version.moduleID, 'version');
	assert.equal(version.alwaysEnabled, true, 'the version beacon must not be switchable off');
	assert.equal(version.hidden, true, 'it has no user-facing settings, so it should not clutter the sidebar');
});

test('version publishes a beacon old reddit will accept, without hiding the fork version', () => {
	// Old reddit blocks expandos for anything reporting an upstream RES version
	// older than 4.3.2.1, and this fork's own numbering is far below that. So the
	// beacon's text is a compatibility floor, and the real version rides along in
	// data-fork-version. Reporting the fork version as the text would silently
	// disable every expando on the site.
	document.body.innerHTML = '';
	mod('version').contentStart();

	const beacon = document.querySelector('#RESConsoleVersion');
	assert.ok(beacon, 'contentStart must publish the beacon reddit reads');

	const [major, minor] = beacon.textContent.replace(/^v/, '').split('.').map(Number);
	assert.ok(
		major > 4 || (major === 4 && minor >= 3),
		`the beacon reports ${beacon.textContent}, which old reddit treats as too old to run expandos`,
	);

	assert.ok(beacon.getAttribute('data-fork-version'), 'the real fork version must still be discoverable');
	assert.equal(beacon.style.display, 'none', 'the beacon is machine-readable only and must not render');
});

test('version marks the document so a second install can detect the first', () => {
	document.body.innerHTML = '';
	mod('version').contentStart();

	const beacon = document.querySelector('#RESConsoleVersion');
	assert.ok(beacon.getAttribute('data-id'), 'without an extension id, two installs cannot tell each other apart');
});

// --- hover -----------------------------------------------------------------

test('hover is a shared service, always enabled, with sane default timings', () => {
	const hover = mod('hover');

	assert.equal(hover.alwaysEnabled, true, 'other modules call into hover directly, so it cannot be disabled');

	for (const key of ['openDelay', 'fadeDelay', 'fadeSpeed', 'width']) {
		const parsed = parseFloat(hover.options[key].value);
		assert.ok(Number.isFinite(parsed), `${key} must parse as a number — it is passed straight to a timer or a style`);
		assert.ok(parsed >= 0, `${key} must not be negative`);
	}
});

test('hover publishes its defaults at beforeLoad, before any consumer asks for them', () => {
	// Consumers call `Hover.infocard(...)` during their own contentStart, which
	// runs after beforeLoad. If the defaults were assigned later, the first
	// hovercard on the page would be built with undefined timings.
	const hover = mod('hover');
	assert.equal(typeof hover.beforeLoad, 'function', 'defaults must be published in the earliest stage');

	assert.doesNotThrow(() => hover.beforeLoad());

	assert.ok(
		Object.prototype.hasOwnProperty.call(hover.options, 'closeOnMouseOut'),
		'the close-on-mouse-out behaviour is part of the shared default set',
	);
});

// --- infiniteScroll --------------------------------------------------------

test('infiniteScroll is scoped to listings and does nothing without a next page', () => {
	const infinite = mod('infiniteScroll');

	assert.deepEqual(infinite.include, ['linklist'], 'it must not run on comment pages or the options page');

	// No `.next-button` in the document: contentStart must bail rather than throw
	// or insert a sentinel that can never do anything.
	document.body.innerHTML = '<div class="sitetable linklisting"></div>';
	assert.doesNotThrow(() => infinite.contentStart());
	assert.equal(document.querySelector('.res-slim-infinite-sentinel'), null, 'no next page means no sentinel');
});

test('infiniteScroll installs a sentinel after the listing when a next page exists', () => {
	const infinite = mod('infiniteScroll');

	document.body.innerHTML = `
		<div class="sitetable linklisting"><div class="thing link"></div></div>
		<span class="next-button"><a href="https://old.reddit.com/?count=25&after=t3_abc">next</a></span>
	`;

	withOption(infinite, 'enabled', true, () => { infinite.contentStart(); });

	const sentinel = document.querySelector('.res-slim-infinite-sentinel');
	assert.ok(sentinel, 'a sentinel is what triggers the next load');

	const listing = document.querySelector('.sitetable.linklisting');
	assert.equal(
		listing.nextElementSibling,
		sentinel,
		'the sentinel must sit immediately after the listing, or it enters the viewport at the wrong time',
	);
});

test('infiniteScroll respects its own enabled option', () => {
	const infinite = mod('infiniteScroll');

	document.body.innerHTML = `
		<div class="sitetable linklisting"></div>
		<span class="next-button"><a href="https://old.reddit.com/?after=t3_x">next</a></span>
	`;

	withOption(infinite, 'enabled', false, () => { infinite.contentStart(); });
	assert.equal(document.querySelector('.res-slim-infinite-sentinel'), null, 'disabled must mean no sentinel');
});

// --- newCommentCount -------------------------------------------------------

test('getNewCount returns nothing for a post that has never been opened', async () => {
	// No stored entry means there is no baseline to diff against, and reporting 0
	// would be wrong — it would claim "no new comments" about a post the user has
	// never seen.
	assert.equal(await NewCommentCount.getNewCount(fakeThing({ fullname: 't3_never_opened' })), undefined);
});

test('getNewCount returns nothing when the comment count is unreadable', async () => {
	const thing = fakeThing({ fullname: 't3_no_count' });
	thing.getCommentCount = () => undefined;

	assert.equal(await NewCommentCount.getNewCount(thing), undefined);
});

test('hasEntry is false for a post with no stored baseline', async () => {
	assert.equal(await NewCommentCount.hasEntry(fakeThing({ fullname: 't3_unknown' })), false);
});

test('newCommentCount is default-on and stores nothing in private browsing by default', () => {
	const ncc = mod('newCommentCount');

	assert.notEqual(ncc.disabledByDefault, true, 'this is one of the modules the README leads with');
	assert.equal(
		ncc.options.monitorPostsVisitedIncognito.value,
		false,
		'recording browsing in a private window by default would be a privacy surprise',
	);
});

// --- infiniteScroll failure handling ---------------------------------------
//
// The regression this covers: `loadNextPage`'s catch used to set the same
// `stopped` flag as the two legitimate end-of-listing paths. One transient
// failure — and reddit 429s aggressively — permanently disabled scrolling for the
// rest of the page, with no retry and nothing distinguishing it from having
// simply reached the end.
//
// `ajax` rejects in this environment (the stubbed chrome.runtime.sendMessage
// returns no response, so the foreground ajax throws a FetchError), which is
// exactly the failure path under test.

function listingWithNextPage() {
	document.body.innerHTML = `
		<div class="sitetable linklisting"><div class="thing link"></div></div>
		<span class="next-button"><a href="https://old.reddit.com/?after=t3_x">next</a></span>
	`;
}

test('the retry backoff doubles per consecutive failure', () => {
	const { backoffMs } = InfiniteScroll;

	assert.equal(backoffMs(1), 2000);
	assert.equal(backoffMs(2), 4000);
	assert.equal(backoffMs(3), 8000);
	// Defensive: a zero or negative count must not produce a negative delay.
	assert.equal(backoffMs(0), 2000);
	assert.ok(backoffMs(-1) > 0);
});

test('a single failure does not end the listing', async () => {
	InfiniteScroll._resetForTest();
	listingWithNextPage();
	InfiniteScroll.module.contentStart();

	await InfiniteScroll.loadNextPage();

	assert.equal(
		document.querySelector('.res-slim-infinite-exhausted'),
		null,
		'one failure must not be reported to the user as the end of the listing',
	);
});

test('after the failure budget is spent, the user is told and offered a retry', async () => {
	InfiniteScroll._resetForTest();
	listingWithNextPage();
	InfiniteScroll.module.contentStart();

	// Each attempt sets a backoff, so clear it between calls the way elapsed time
	// would. Without this the second and third attempts return immediately and the
	// budget is never spent — which would make this test pass for the wrong reason.
	for (let i = 0; i < InfiniteScroll.MAX_FAILURES; i++) {
		InfiniteScroll._clearBackoffForTest();
		await InfiniteScroll.loadNextPage(); // eslint-disable-line no-await-in-loop
	}

	const notice = document.querySelector('.res-slim-infinite-exhausted');
	assert.ok(notice, 'giving up silently is indistinguishable from reaching the end of the listing');
	assert.match(notice.textContent, /could not load/i, 'the notice must say what went wrong');

	const retry = notice.querySelector('button');
	assert.ok(retry, 'a rate limit clears on its own, so there must be a way to try again');
	assert.match(retry.textContent, /try again/i);
});

test('the notice is not duplicated if the exhausted path is reached twice', async () => {
	InfiniteScroll._resetForTest();
	listingWithNextPage();
	InfiniteScroll.module.contentStart();

	for (let i = 0; i < InfiniteScroll.MAX_FAILURES + 2; i++) {
		InfiniteScroll._clearBackoffForTest();
		await InfiniteScroll.loadNextPage(); // eslint-disable-line no-await-in-loop
	}

	assert.equal(document.querySelectorAll('.res-slim-infinite-exhausted').length, 1);
});
