/* @flow */
// RES-Slim: click old.reddit's "load more comments" stubs for you.
//
// Concept from "Reddit - Auto Load More Comments" (Greasy Fork 10164) and its
// several forks. Those scripts loop on a bare `setInterval` with no cap, which
// on a large thread issues hundreds of morechildren requests in parallel and
// gets the account rate-limited — the top complaint in their feedback threads.
//
// Here every click goes through the shared rate limiter, the run stops at a
// configurable ceiling, and it stops immediately if reddit starts returning
// stubs that do not resolve (which is what a rate-limit response looks like from
// the DOM's point of view: the stub is still there afterwards).

import { Module } from '../core/module';
import { isPageType } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';

export const module: Module<*> = new Module('autoLoadMoreComments');

module.moduleName = 'Auto-load more comments';
module.category = 'commentsCategory';
module.description = 'Clicks the "load more comments" stubs at the bottom of a thread so the whole discussion is present without repeated clicking. Rate-limited and capped, because an uncapped run gets the account throttled on a big thread.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['comments', 'load', 'more', 'expand', 'morechildren'];

module.options = {
	maxClicks: {
		type: 'text',
		value: '25',
		title: 'Maximum stubs to load',
		description: 'A ceiling per page load. A very large thread can contain thousands of stubs; loading them all takes minutes and makes the page unusable.',
	},
	requestsPerSecond: {
		type: 'enum',
		value: '2',
		values: [
			{ name: 'Gentle (1 per second)', value: '1' },
			{ name: 'Normal (2 per second)', value: '2' },
			{ name: 'Fast (4 per second)', value: '4' },
		],
		title: 'Request rate',
		description: 'How quickly to click stubs. Reddit throttles morechildren aggressively, so slower finishes sooner in practice.',
	},
	skipDeepThreads: {
		type: 'boolean',
		value: false,
		title: 'Skip "continue this thread" stubs',
		description: 'Those stubs navigate to a new page rather than expanding in place. The continueThreadInline module handles them properly; leave this on if you use it.',
	},
};

// The two stub shapes old.reddit renders. `.morecomments` expands in place;
// `.deepthread` (the "continue this thread" link) navigates away.
const STUB_SELECTOR = 'span.morecomments > a';
const CLICKED_ATTR = 'data-rsm-autoloaded';

function stubs(): HTMLAnchorElement[] {
	const skipDeep = module.options.skipDeepThreads.value === true;
	return ([...document.querySelectorAll(STUB_SELECTOR)]: any).filter((a: HTMLAnchorElement) => {
		if (a.hasAttribute(CLICKED_ATTR)) return false;
		if (skipDeep && /continue this thread/i.test(a.textContent || '')) return false;
		return true;
	});
}

async function run() {
	const cap = parseInt(module.options.maxClicks.value, 10);
	const max = Number.isFinite(cap) && cap > 0 ? cap : 25;
	const perSecond = parseInt(module.options.requestsPerSecond.value, 10) || 2;
	const limiter = createRateLimiter({ tokens: perSecond, refillMs: Math.round(1000 / perSecond), maxConcurrent: 1 });

	let clicked = 0;
	// Consecutive rounds where clicking produced no new content. Two in a row
	// means reddit is refusing, not that the thread is deep — keep going and the
	// run turns into a throttle loop.
	let barren = 0;

	while (clicked < max && barren < 2) {
		const pending = stubs();
		if (!pending.length) break;

		const before = document.querySelectorAll('.comment').length;
		const batch = pending.slice(0, Math.min(max - clicked, pending.length));

		// Sequential by design: each round has to observe the result of the last
		// one to decide whether reddit is still answering.
		// eslint-disable-next-line no-await-in-loop
		await Promise.all(batch.map(anchor => limiter.schedule(async () => {
			anchor.setAttribute(CLICKED_ATTR, '1');
			anchor.click();
			clicked++;
			// reddit replaces the stub asynchronously; give it a beat before the
			// next round counts comments, or every round looks barren.
			await new Promise(resolve => { setTimeout(resolve, 400); });
		})));

		barren = document.querySelectorAll('.comment').length > before ? 0 : barren + 1;
	}
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	// Deliberately not awaited: a slow thread must not hold up the rest of the
	// module chain, and nothing downstream depends on the result.
	run();
};
