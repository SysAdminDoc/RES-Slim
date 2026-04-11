/* @flow */
// RES-Slim: minimal infinite-scroll for listing pages. IntersectionObserver-based,
// no jQuery / jscroll dependency. Follows Reddit's `.next-button a` to fetch the
// next page, parses out the `.sitetable.linklisting > .thing` entries, and appends.
// Much smaller than upstream RES's neverEndingReddit, but covers 90% of the use case.

import { Module } from '../core/module';
import { isPageType, registerPage } from '../utils';
import { ajax } from '../environment';

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
let stopped = false;

async function loadNextPage() {
	if (loading || stopped || !nextUrl || module.options.pause.value) return;
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
	} catch {
		stopped = true;
	} finally {
		loading = false;
	}
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
