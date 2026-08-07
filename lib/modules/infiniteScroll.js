/* @flow */
// RES-Slim: minimal infinite-scroll for listing pages. IntersectionObserver-based,
// no jQuery / jscroll dependency. Follows Reddit's `.next-button a` to fetch the
// next page, parses out the `.sitetable.linklisting > .thing` entries, and appends.
// Much smaller than upstream RES's neverEndingReddit, but covers 90% of the use case.

import { Module } from '../core/module';
import { isPageType, registerPage } from '../utils';
import { ajax } from '../environment';
import { getStatusFromError } from '../utils/redditApiStatus';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<*> = new Module('infiniteScroll');

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
		const divider = document.createElement('div');
		divider.className = 'res-slim-infinite-divider';
		divider.textContent = '\u2500 page loaded \u2500';
		divider.style.cssText = 'text-align:center; padding:6px; opacity:0.6; font-size:11px;';
		currentListing.append(divider);
		for (const t of newThings) {
			currentListing.append(t);
			// Ensure the appended thing gets registered with RES's watcher system so that
			// other modules (selectedEntry, commentHighlights, subredditBlacklist, etc.)
			// see it. Watchers use a WeakSet, so double-registration is a no-op.
			if (t instanceof HTMLElement) registerPage(t);
		}
		const nextLink: ?HTMLAnchorElement = (doc.querySelector('.next-button a'): any);
		nextUrl = nextLink ? nextLink.href : null;
		if (!nextUrl) stopped = true;

		// A page that loads clears the slate: the next failure starts from scratch.
		failures = 0;
		retryAfter = 0;
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

module.contentStart = () => {
	if (!isPageType('linklist')) return;
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
