/* @flow */

import { memoize, once } from './functional';
import { Thing } from './Thing';
import { isPageType } from './currentLocation';
import { isLastNodeInDOM, watchForFutureChildren, watchForFutureDescendants, waitForAttach, waitForDescendantChange, waitForSelectorMatch, watchForChildren } from './dom';
import { contentLoaded } from './pagePhases';
import { MINUTE } from './time';

type WatcherOptions = {| immediate?: boolean, id?: mixed |};

type ElementWatcherType = 'page' | 'selfText';
type ElementWatcherCallback = (e: HTMLElement) => any;

const elementWatchers: {
	[ElementWatcherType]: Array<{
		selector: ?string,
		callback: ElementWatcherCallback,
		options?: WatcherOptions,
		registered: WeakSet<*>,
	}>,
} = {
	page: [],
	selfText: [],
};

type ThingWatcherType = 'comment' | 'message' | 'post' | 'subreddit';
type ThingWatcherCallback = (thing: Thing) => any;

const thingWatchers: {
	[ThingWatcherType]: Array<{
		callback: ThingWatcherCallback,
		options?: WatcherOptions,
		registered: WeakSet<*>,
	}>,
} = {
	comment: [],
	message: [],
	post: [],
	subreddit: [],
};


const runCallback = fn => { try { return fn(); } catch (e) { console.error(e); } };

const addCallback = (callback, actingOnElement, { immediate, id } = {}) => {
	const thing = Thing.from(actingOnElement);
	if (thing) {
		// XXX The callback ought not be wrapped so many times
		const task = once(() => runCallback(callback));
		if (id) thing.tasks.byId.set(id, task);
		(immediate ? thing.tasks.immediate : thing.tasks.visible).push(task);
		if (immediate || thing.tasks.completed) task();
	} else {
		runCallback(callback);
	}
};

function registerElement(type, element) {
	for (const { selector, callback, options, registered } of elementWatchers[type]) {
		const elements = selector && !element.matches(selector) ?
			Array.from(element.querySelectorAll(selector)) :
			[element];
		for (const e of elements) {
			if (registered.has(e)) continue;
			registered.add(e);
			addCallback(() => callback(e), e, options);
		}
	}
}

// Cleared on an SPA route change. It maps a fullname to the element showing it,
// and current Reddit replaces the whole feed without a reload, so without this
// the map both grew without bound and pinned every element of every feed the
// session had ever rendered. Clearing is also correct on its own terms: a
// different page legitimately shows a post the previous one did.
const dupeSet = new Map();
if (typeof document !== 'undefined' && document.addEventListener) {
	document.addEventListener('reddit.urlChanged', () => { dupeSet.clear(); });
}

// `t<kind>_<base36 id>`. Reddit's id counter has grown from five characters to
// seven since this dedupe was written, so the old `id.length === 9` test stopped
// matching any post created in the last few years and switched duplicate removal
// off for everything on the site. Match the shape instead of a fixed width.
const FULLNAME = /^t\d+_[a-z0-9]+$/i;

function registerThing(element: HTMLElement) {
	const thing = Thing.checkedFrom(element);

	// Loading additional things ("load more comments", neverEndingReddit) may cause repeating posts; remove those
	const id = thing.getFullname();
	// Some posts may not have a have an id, e.g. those that are deleted or placeholders
	if (FULLNAME.test(id)) {
		const existing = dupeSet.get(id);
		if (existing === element) return; // `registerThing` is being run on an already added thing
		// A thing nested inside its own earlier copy is a spliced continuation
		// (continueThreadInline replaces a "continue this thread" link with the
		// fetched subtree, which is rooted at a comment already on the page), not
		// a repeated listing entry. Removing it would delete what was just loaded.
		const nested = existing && (existing.contains(element) || element.contains(existing));
		if (existing && !nested && document.contains(existing)) {
			element.remove();
			return;
		}

		dupeSet.set(id, element);
	}

	const thingWatcherCallbacks =
		thing.isPost() && thingWatchers.post ||
		thing.isComment() && thingWatchers.comment ||
		thing.isMessage() && thingWatchers.message ||
		thing.isSubreddit() && thingWatchers.subreddit ||
		[];

	for (const { callback, options, registered } of thingWatcherCallbacks) {
		if (registered.has(thing)) continue;
		registered.add(thing);
		addCallback(() => callback(thing), thing.element, options);
	}
}

export function watchForThings(types: ?Array<ThingWatcherType>, callback: ThingWatcherCallback, options?: WatcherOptions) {
	if (!types) types = Object.keys(thingWatchers);
	const entry = { callback, options, registered: new WeakSet() };
	for (const type of types) thingWatchers[type].push(entry);
}

export function watchForElements(types: Array<ElementWatcherType>, selector: ?string, callback: ElementWatcherCallback, options?: WatcherOptions) {
	const entry = { selector, callback, options, registered: new WeakSet() };
	for (const type of types) elementWatchers[type].push(entry);
}

export function registerPage(page: HTMLElement) {
	if (page.matches(Thing.thingSelector)) registerThing(page);
	for (const ele of page.querySelectorAll(Thing.thingSelector)) registerThing(ele);
	registerElement('page', page);
}

const HIDE_FOLLOWING_CLASS = 'res-hide-following';

const cleanHideClasses = () => {
	for (const ele of [...document.getElementsByClassName(HIDE_FOLLOWING_CLASS)]) ele.classList.remove(HIDE_FOLLOWING_CLASS);
};

export async function r2WatcherContentStart() {
	const initialProcessSize: number = Math.ceil((screen.availHeight / window.devicePixelRatio) / 55 /* approx min height of a thing */);
	const container = document.body.querySelector('.content[role="main"]');

	// Add selftext observer
	watchForThings(['post'], async thing => {
		const container = thing.entry.querySelector('div.expando');
		if (!container) return;
		let body = thing.getTextBody();
		if (!body || container.matches('.thing.spoiler .expando')) {
			// The class `expando--with-interstitial` means that the text is blocked by the "spoiler" dialog
			await waitForSelectorMatch(container, ':not(.expando--with-interstitial, .expando-uninitialized)');
		}
		watchForChildren(container, 'form', () => {
			body = thing.getTextBody();
			if (body) registerElement('selfText', body);
		});
	}, { immediate: true });

	// Run tasks on a few things manually, since the IntersectionObserver requires at least one paint before invoking callback
	// By running tasks on what is likely to be displayed on first paint, we avoid an extra reflow
	watchForThings(null, (() => {
		let max = initialProcessSize;
		// Keyed by identity rather than by a resettable index. The old version held
		// an array plus a counter that a 30s interval reset to zero; a `check`
		// closure captured its index `n` and later ran `delete queue[n]`, so after a
		// reset it could delete a *different*, newly-enqueued Thing’s entry — that
		// Thing then never ran its tasks and silently rendered with no expando and
		// no filtering.
		let queue = new Map();
		let i = 0;
		// Reset every half minute so new things are processed fast when loading additional things via neverEndingReddit / "more comments" etc
		contentLoaded.then(() => { setInterval(() => { queue = new Map(); i = 0; }, 0.5 * MINUTE); });
		return thing => {
			const n = i++;
			const own = queue;
			const check = async () => {
				// Delete from the map this closure was registered in, so a reset that
				// swapped the map cannot make us touch a later Thing.
				own.delete(thing);
				// Whether a thing will be visible, is usually ascertained when the filter task has been completed
				const filterTask = thing.tasks.byId.get('filter');
				if (filterTask instanceof Promise) await filterTask();
				if (thing.tasks.completed || thing.isVisible()) {
					thing.runTasks();
				} else if (n < max) {
					max++;
					const nextCheck = own.values().next().value;
					if (nextCheck) nextCheck();
				}
			};
			queue.set(thing, check);
			if (n < max) check();
		};
	})(), { immediate: true });

	// Execute non-immediate callbacks on things when they become visible
	const io = new IntersectionObserver(entries => {
		for (const { target, isIntersecting } of entries) {
			if (isIntersecting) {
				io.unobserve(target);
				(Thing.checkedFrom(target)).runTasks();
			}
		}
	}, { rootMargin: '100%', delay: 200 });

	watchForThings(null, async thing => {
		if (thing.tasks.completed) return;
		// By starting observing before the element is attached (e.g. when invoked via neverEndingReddit), the IO may not trigger
		if (!container.contains(thing.element)) await waitForAttach(container, thing.element);
		io.observe(thing.entry);
	}, { immediate: true });

	const getReadyThingElements = () => {
		Thing.thingElements.cache.clear();
		const thingElements = Thing.thingElements(container);

		let _last = thingElements.slice(-1)[0];
		if (_last) {
			// Check if the last element (tree?) is complete
			// If there's no nodes in the DOM after it, its contents might not be ready to be processed
			// so hide it and defer work until it's ready
			if (isLastNodeInDOM(_last)) {
				thingElements.pop();
				// Set `_last` to the previously post or the element before (or before parent) this thing
				if (thingElements.length) {
					_last = thingElements.slice(-1)[0];
				} else {
					while (!_last.previousElementSibling) { _last = _last.parentElement; }
					_last = _last.previousElementSibling;
				}
			}

			cleanHideClasses();
			// Hide the following elements until 'contentLoaded',
			// to prevent them being painted without the 'immediate' watchers having been invoked on them
			do { _last.classList.add(HIDE_FOLLOWING_CLASS); } while ((_last = _last.parentElement) && _last !== container);
		}

		return thingElements;
	};

	while (true) {
		const thingElements = getReadyThingElements();
		for (const e of thingElements) registerThing(e);

		if (thingElements.length >= initialProcessSize) return;

		// One controller per pass. `contentLoaded` winning the race used to leave
		// that iteration's subtree observer attached to the container with nobody
		// left to resolve it, once per pass around this loop.
		const stopWatching = new AbortController();
		const changed = waitForDescendantChange(container, Thing.thingSelector, { signal: stopWatching.signal, timeout: Infinity });
		changed.catch(() => {}); // losing the race is the ordinary ending here
		try {
			await Promise.race([ // eslint-disable-line no-await-in-loop
				contentLoaded.then(() => Promise.reject()), // eslint-disable-line prefer-promise-reject-errors
				Promise.all([
					// Give the browser some time to load additional posts into the DOM before continuing if we've already processed some
					thingElements.length ? (new Promise(res => { setTimeout(res, 100); })) : Promise.resolve(),
					changed,
				]),
			]);
		} catch (e) {
			// `r2WatcherContentLoaded` has run by now
			break;
		} finally {
			stopWatching.abort();
		}
	}
}

export function r2WatcherContentLoaded() {
	cleanHideClasses();

	// Things may be edited/loaded using the Reddit interface
	if (isPageType('comments')) {
		const commentarea = document.body.querySelector('.commentarea');
		if (commentarea) watchForFutureDescendants(commentarea, '.thing', registerPage, true);
	} else {
		const watchList = memoize(ele => { if (ele) watchForFutureChildren(ele, '.thing', registerPage); });
		watchForThings(null, thing => { watchList(thing.element.parentElement); });
	}

	registerPage(document.body);
}
