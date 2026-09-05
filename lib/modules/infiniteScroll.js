/* @flow */
// RES-Slim: minimal infinite-scroll for listing pages. IntersectionObserver-based,
// no jQuery / jscroll dependency. Follows Reddit's `.next-button a` to fetch the
// next page, parses out the `.sitetable.linklisting > .thing` entries, and appends.
// Much smaller than upstream RES's neverEndingReddit, but covers 90% of the use case.

import { Module } from '../core/module';
import { getRouteSignal } from '../core/modules/modules';
import { findSurface } from '../core/dom/selectors';
import { isAppType, isPageType, registerPage } from '../utils';
import { ajax } from '../environment';
import { getStatusFromError } from '../utils/redditApiStatus';
import { FULLNAME } from '../utils/watchers';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<{ [string]: any }> = new Module('infiniteScroll');

module.moduleName = 'Infinite scrolling';
module.category = 'browsingCategory';
module.description = 'Automatically loads the next page of posts as you scroll. Works on subreddit listings, multireddits, /r/all, and your front page.';
module.descriptionRaw = true;
module.include = ['linklist'];
module.options = {
	enabled: {
		type: 'boolean',
		value: true,
		title: 'Enabled',
		description: 'Enable infinite scrolling on listing pages.',
	},
	pause: {
		type: 'boolean',
		value: false,
		title: 'Pause',
		description: 'Temporarily stop loading more pages (useful on slow connections).',
	},
	limitCurrentReddit: {
		type: 'boolean',
		value: false,
		title: 'Stop current Reddit from loading forever',
		description: 'Current Reddit has its own infinite feed and no way to turn it off. This puts a stop to it after a set number of posts and gives you a button to carry on. Off by default, because it changes how Reddit itself behaves.',
	},
	currentRedditLimit: {
		type: 'text',
		value: '100',
		title: 'Posts to load before pausing',
		description: 'How many posts current Reddit may append before it pauses. Each press of the button allows the same number again.',
	},
};

let loading = false;
let nextUrl: ?string = null;
// `stopped` means "there is nothing further to load" — the listing genuinely
// ended. It must not be set by a failed request: reddit 429s aggressively, and
// conflating the two meant one transient failure permanently disabled scrolling
// for the rest of the page, with no retry and nothing to tell the user why.
let stopped = false;
// Consecutive failures. Reset on any success, so a page that fails once and then
// recovers is not counted against its budget forever.
let failures = 0;
export const MAX_FAILURES = 3;
// Backoff before the next attempt is allowed, doubling per consecutive failure.
// Consecutive pages that added nothing.
//
// The overlap dedupe means a page of pure overlap changes the DOM by nothing at
// all — no rows, no divider. The only thing that asks for another page is the
// `IntersectionObserver` on the sentinel, and that fires on intersection
// *transitions*: with the sentinel already inside the 800px root margin and the
// geometry unchanged, no further callback ever arrives, so scrolling stops until
// the reader scrolls the sentinel out and back. `stopped` is false and
// `nextUrl` has advanced, so nothing else re-arms it.
//
// So a page that adds nothing asks for the next one itself. Bounded, because a
// listing that has genuinely run out of new posts would otherwise walk to
// reddit's thousand-item pagination ceiling as fast as the rate limiter allows.
let emptyPages = 0;
let chainAfterEmptyPage = false;
const MAX_EMPTY_PAGES = 3;

const RETRY_BASE_MS = 2000;
let retryAfter = 0;

// Exported for the contract: the retry schedule is the behaviour worth pinning,
// and it is otherwise unreachable from outside.
export function backoffMs(consecutiveFailures: number): number {
	return RETRY_BASE_MS * (2 ** Math.max(0, consecutiveFailures - 1));
}

// Clears only the backoff window. A test that drives consecutive failures has no
// way to let wall-clock time pass, and without this the second attempt returns at
// the backoff guard — so the failure budget would never be spent and the test
// would pass without reaching the path it exists to check.
export function _clearBackoffForTest() {
	retryAfter = 0;
}

export function _resetForTest() {
	loading = false;
	nextUrl = null;
	stopped = false;
	failures = 0;
	retryAfter = 0;
	emptyPages = 0;
}

// A link's fullname. `FULLNAME` is the shape test the watcher dedupe uses, and
// `t3_` narrows it to posts: a listing holds nothing else, and matching any kind
// would let a comment id collide with a post id.
export function isLinkFullname(id: mixed): boolean {
	return typeof id === 'string' && id.startsWith('t3_') && FULLNAME.test(id);
}

// The set the append loop compares against. Read from the page rather than kept
// in module state, because the listing is also changed by things this module
// does not own — a filter removing a row, reddit's own markup, a reload — and a
// cached set would drift from what is actually on screen.
export function seenFullnames(listing: HTMLElement): Set<string> {
	const seen = new Set();
	for (const thing of listing.querySelectorAll('.thing')) {
		const id = thing.getAttribute('data-fullname') || '';
		if (isLinkFullname(id)) seen.add(id);
	}
	return seen;
}

// Exported for the contract. The only in-product caller is the sentinel
// observer, which a jsdom test cannot make intersect.
export async function loadNextPage() {
	if (loading || stopped || !nextUrl || module.options.pause.value) return;
	if (Date.now() < retryAfter) return;
	loading = true;
	try {
		const html = await ajax({ url: nextUrl, type: 'text' });
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const newThings = doc.querySelectorAll('.sitetable.linklisting > .thing');
		const currentListing = document.querySelector('.sitetable.linklisting');
		if (!currentListing) { stopped = true; return; }
		if (!newThings.length) { stopped = true; return; }
		// Reddit's `after` cursor overlaps: consecutive pages routinely share rows,
		// and a post that moves up the listing between two fetches is served twice.
		// `registerThing` removes a repeat, but only after it has been fetched,
		// parsed, inserted and registered, and the divider is emitted either way \u2014
		// so a page of pure overlap still draws a separator with nothing under it.
		// Deciding here is the layer that costs nothing.
		const seen = seenFullnames(currentListing);
		const fresh = [];
		for (const t of newThings) {
			if (!(t instanceof HTMLElement)) continue;
			const id = t.getAttribute('data-fullname') || '';
			// A row with no usable fullname \u2014 a placeholder, a deleted post, an ad \u2014
			// cannot be compared against anything, so it is kept. Dropping unique
			// content to be safe about duplicates is the worse trade.
			if (isLinkFullname(id)) {
				if (seen.has(id)) continue;
				seen.add(id);
			}
			fresh.push(t);
		}

		// No divider for a page that added nothing.
		if (fresh.length) {
			const divider = document.createElement('div');
			divider.className = 'res-slim-infinite-divider';
			divider.textContent = '\u2500 page loaded \u2500';
			divider.style.cssText = 'text-align:center; padding:6px; opacity:0.6; font-size:11px;';
			currentListing.append(divider);
		}

		for (const t of fresh) {
			currentListing.append(t);
			// Ensure the appended thing gets registered with RES's watcher system so that
			// other modules (selectedEntry, commentHighlights, subredditBlacklist, etc.)
			// see it. Watchers use a WeakSet, so double-registration is a no-op.
			registerPage(t);
		}
		const nextLink: ?HTMLAnchorElement = (doc.querySelector('.next-button a'): any);
		nextUrl = nextLink ? nextLink.href : null;
		if (!nextUrl) stopped = true;

		// A page that loads clears the slate: the next failure starts from scratch.
		failures = 0;
		retryAfter = 0;

		emptyPages = fresh.length ? 0 : emptyPages + 1;
		if (!fresh.length && nextUrl && !stopped && emptyPages < MAX_EMPTY_PAGES) chainAfterEmptyPage = true;
	} catch (e) {
		failures++;

		// A rate limit is the common case and worth naming, so the user knows the
		// feature is throttled rather than broken. Throttled internally, so a long
		// scroll cannot produce a stream of toasts.
		const status = getStatusFromError(e);
		if (status !== null) notifyRedditApiBlocked(status);

		if (failures >= MAX_FAILURES) {
			// Give up on this page, but say so — silently ceasing to load looks
			// identical to reaching the end of the listing.
			stopped = true;
			showExhausted();
		} else {
			retryAfter = Date.now() + backoffMs(failures);
		}
	} finally {
		loading = false;
	}

	// Outside the `finally`, and after `loading` is back down, so the next attempt
	// is not refused by its own guard. Scheduled rather than recursed: the rate
	// limiter is reddit's, and a synchronous chain would be a loop with no gap in
	// it.
	if (chainAfterEmptyPage) {
		chainAfterEmptyPage = false;
		setTimeout(() => { loadNextPage(); }, 0);
	}
}

function showExhausted() {
	const listing = document.querySelector('.sitetable.linklisting');
	if (!listing || listing.querySelector('.res-slim-infinite-exhausted')) return;

	const notice = document.createElement('div');
	notice.className = 'res-slim-infinite-exhausted';
	notice.textContent = 'Could not load more posts. ';

	// A retry affordance rather than a dead end: the usual cause is a temporary
	// rate limit, which clears on its own.
	const retry = document.createElement('button');
	retry.type = 'button';
	retry.textContent = 'Try again';
	retry.addEventListener('click', () => {
		notice.remove();
		stopped = false;
		failures = 0;
		retryAfter = 0;
		loadNextPage();
	});

	notice.append(retry);
	listing.append(notice);
}

// Current Reddit's feed loads the next page by putting one of these in the DOM
// and letting it fetch itself. Take it out and the appending stops; put it back
// and it resumes. That is the whole mechanism.
export const D2X_FEED_SENTINEL = 'faceplate-partial[src^="/svc/shreddit/feeds/"]';
const D2X_POSTS = 'shreddit-post, shreddit-ad-post';

function postLimit(): number {
	const raw = parseInt(String(module.options.currentRedditLimit.value || ''), 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

// The teardown for the limiter that is armed right now, or null when none is.
//
// Current Reddit navigates without unloading, and it replaces the feed element
// on the way. So "for the life of the page" — which is what this observer used
// to say — means an observer still watching the feed you scrolled away from,
// while the listing you arrived at has none. It is armed per route now, and the
// route signal is what takes it down again.
let armedLimit: ?(() => void) = null;

function setUpCurrentRedditLimit(): void {
	if (armedLimit) return;

	const feed = findSurface('listingFeed', document, 'd2x');
	if (!feed) return;

	const step = postLimit();
	let ceiling = step;
	// The last sentinel taken out, with where it came from, so pressing the
	// button puts it back rather than hoping reddit makes another one.
	let parked: ?{| node: Element, parent: Node, next: ?Node |} = null;

	const control = document.createElement('div');
	control.className = 'rsm-infiniteScroll-limit';
	control.hidden = true;

	const note = document.createElement('p');
	note.className = 'rsm-infiniteScroll-limitNote';

	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'rsm-infiniteScroll-loadMore';
	button.textContent = 'Load more posts';

	control.append(note, button);
	// After the feed, never inside it and never in place of it. Every project
	// that tried hiding `shreddit-feed` found reddit stops loading into it
	// entirely, which turns a pause into a broken page.
	if (feed.parentNode) feed.parentNode.insertBefore(control, feed.nextSibling);

	const countPosts = () => feed.querySelectorAll(D2X_POSTS).length;

	const park = () => {
		for (const node of feed.querySelectorAll(D2X_FEED_SENTINEL)) {
			parked = { node, parent: node.parentNode || feed, next: node.nextSibling };
			node.remove();
		}
	};

	const check = () => {
		if (countPosts() < ceiling) return;
		park();
		if (!parked) return;
		note.textContent = `Paused after ${countPosts()} posts.`;
		control.hidden = false;
	};

	button.addEventListener('click', () => {
		ceiling = countPosts() + step;
		control.hidden = true;
		if (!parked) return;
		const { node, parent, next } = parked;
		parked = null;
		parent.insertBefore(node, next || null);
	});

	// Watching the feed *is* the feature, so unlike the waiters in
	// `lib/utils/dom.js` this has nothing to time out on. What ends it is the
	// route ending.
	const observer = new MutationObserver(check);
	observer.observe(feed, { childList: true, subtree: true });
	check();

	const teardown = () => {
		if (armedLimit !== teardown) return;
		armedLimit = null;
		observer.disconnect();
		control.remove();
		// Leaving with the sentinel parked would strand the feed for good: our
		// button is the only way to put it back, and it is going away with us.
		if (parked) {
			const { node, parent, next } = parked;
			parked = null;
			parent.insertBefore(node, next || null);
		}
	};

	armedLimit = teardown;
	getRouteSignal().addEventListener('abort', teardown, { once: true });
}

// Every route, not just the one the module first became eligible on. A page
// stage runs once, so without this the limiter is armed on the listing you
// landed on and on no listing you navigate to afterwards.
function armCurrentRedditLimit(): void {
	if (!isPageType('linklist')) return;
	if (!module.options.limitCurrentReddit.value) return;
	setUpCurrentRedditLimit();
}

module.contentStart = () => {
	if (!isPageType('linklist')) return;

	if (isAppType('d2x')) {
		// The opposite feature on the other renderer: current Reddit has an
		// infinite feed built in and no way to stop it, and this module's own
		// `enabled` option means "scroll forever on old Reddit", so the two are
		// gated separately.
		//
		// The listener is on the document rather than on a stage signal on
		// purpose: a route change is what re-arms this, so a subscription scoped
		// to one route would cancel the thing that does the re-arming.
		document.addEventListener('reddit.urlChanged', armCurrentRedditLimit);
		armCurrentRedditLimit();
		return;
	}

	if (!module.options.enabled.value) return;

	const nextButton: ?HTMLAnchorElement = (document.querySelector('.next-button a'): any);
	if (!nextButton) return;
	nextUrl = nextButton.href;

	// Use a sentinel at the bottom of the current listing; IntersectionObserver triggers
	// loading when it enters the viewport.
	const sentinel = document.createElement('div');
	sentinel.className = 'res-slim-infinite-sentinel';
	sentinel.style.height = '1px';
	const listing = document.querySelector('.sitetable.linklisting');
	if (!listing || !listing.parentNode) return;
	listing.parentNode.insertBefore(sentinel, listing.nextSibling);

	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (entry.isIntersecting) loadNextPage();
		}
	}, { rootMargin: '800px' });
	observer.observe(sentinel);
};
