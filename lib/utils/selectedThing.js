/* @flow */

import { LAST_SELECTED_ENTRY_KEY } from '../constants/sessionStorage';
import { maxBy, sortBy, throttle } from './functional';
import type { ScrollStyle } from './dom';
import {
	Thing,
	getPercentageVisibleYAxis,
	scrollToElement,
	watchForThings,
	frameThrottle,
	frameDebounce,
	idleThrottle,
} from './';

export let current: ?Thing;
let currentContainer: ?Element;
let previous;

type SelectOptions = {
	allowMediaBrowse?: boolean,
	scrollStyle: ScrollStyle,
};

type SelectOptionsWithDirection = SelectOptions & { direction?: 'down' | 'up' };

const listeners = { instantly: [], beforePaint: [], idle: [] };

export function addListener(
	callback: (new_: Thing, old: ?Thing, opt: SelectOptionsWithDirection) => mixed,
	when: $Keys<typeof listeners> = 'idle',
	priority: number = 0,
): void {
	callback.priority = priority;
	listeners[when].push(callback);
	listeners[when].sort((a, b) => a.priority - b.priority);
}

const runCallbacks = (() => {
	function runListeners(listeners, new_, old, opt) {
		for (const listener of listeners) try { listener(new_, old, opt); } catch (e) { console.error(e); }
	}

	function throttleListeners(throttler, listeners) {
		let oldest: ?Thing; // So that `oldest` will equal `new_` from the previous listener invokation

		const throttled = throttler((new_: Thing, old: ?Thing, opt: SelectOptionsWithDirection) => {
			runListeners(listeners, new_, oldest, opt);
			oldest = null;
		});

		return (new_, old, opt) => {
			if (!oldest) oldest = old;
			throttled(new_, old, opt);
		};
	}

	const runBeforePaint = throttleListeners(frameThrottle, listeners.beforePaint);
	const runIdle = throttleListeners(idleThrottle, listeners.idle);

	return (new_, old, opt) => {
		if (listeners.instantly.length) runListeners(listeners.instantly, new_, old, opt);
		if (listeners.beforePaint.length) runBeforePaint(new_, old, opt);
		if (listeners.idle.length) runIdle(new_, old, opt);
	};
})();

export function set(_new: Thing, options: SelectOptions = { scrollStyle: 'none' }, force: boolean = false) {
	if (!force && _new === current) return;

	previous = current;
	current = _new;
	currentContainer = current.element.closest('.sitetable');

	const direction = previous && previous.getDirectionOf(current);
	runCallbacks(current, previous, { ...options, ...(direction ? { direction } : undefined) });
}

export const selectClosestInView = frameDebounce(() => {
	if (current && getPercentageVisibleYAxis(current.entry)) return;

	const closestToCurrent = current && current.getClosestVisible();
	if (closestToCurrent && getPercentageVisibleYAxis(closestToCurrent.entry)) {
		set(closestToCurrent);
		return;
	}

	const things = Thing.visibleThings();
	const currentIndex = things.indexOf(current);
	const closestThings = sortBy(things.filter(thing => thing.isVisible()), thing => Math.abs(things.indexOf(thing) - currentIndex));
	const closestVisible = maxBy(closestThings, ({ entry }) => getPercentageVisibleYAxis(entry));
	if (closestVisible) set(closestVisible);
});

// `refresh()`, `movers` and `move()` were here. All three were exported or
// reachable only from each other, and nothing in lib, tests or scripts called
// them: upstream drove them from `keyboardNav`, which this fork does not ship.
// The whole API anything uses is `addListener`, `current`, `set`,
// `selectClosestInView` and `setScrollToSelectedThingOnLoad`.

let anchor;
// Partially visible comments may change height change depending on whether they are current,
// so it is necessary to anchor them to avoid having viewport move relative to the current thing
// XXX Can the native browser scroll anchoring achieve this?
addListener((current, previous, { scrollStyle }) => {
	if (
		previous && current !== previous &&
		(['none', 'adopt']: Array<ScrollStyle>).includes(scrollStyle) &&
		(current.element.classList.contains('res-thing-partial') || previous.element.classList.contains('res-thing-partial'))
	) {
		anchor = {
			to: current.entry.getBoundingClientRect().top,
			from: previous.entry.getBoundingClientRect().top,
		};
	} else {
		anchor = undefined;
	}
}, 'instantly', -Infinity);

addListener((current, previous, { direction, scrollStyle }) => {
	scrollToElement(current.entry, previous && previous.entry, { scrollStyle, direction, anchor, waitTillVisible: true });
}, 'beforePaint', 9);

// Complete tasks on Things when e.g. using keyboardNav or commentNav, so that RES watcher tasks are run before painting
addListener(current => {
	current.runSurroundingTasks();
}, 'instantly');

// When loading additonal comments, select the first newly loaded comment
watchForThings(['comment'], throttle(thing => {
	if (!current) return;
	if (current && document.contains(current.element)) return;
	if (currentContainer && currentContainer !== thing.element.closest('.sitetable')) return;
	set(thing);
}, 100, { leading: true, trailing: false }), { immediate: true });

const lastSelectedKey = `${LAST_SELECTED_ENTRY_KEY}-${location.pathname}`;
const getLastSelectedId = () => sessionStorage[lastSelectedKey];
let scrollToSelectedThingOnLoad: boolean = false;
export const setScrollToSelectedThingOnLoad = (v: boolean) => { scrollToSelectedThingOnLoad = v; };

// Auto select the previous selected thing this session, or the first thing
const lastSelectedId = getLastSelectedId();
watchForThings(null, thing => {
	if (current) return;
	if (!lastSelectedId) return set(thing);
	if (thing.getFullname() !== lastSelectedId) return;
	if (scrollToSelectedThingOnLoad) history.scrollRestoration = 'manual';
	set(thing, { scrollStyle: history.scrollRestoration === 'manual' ? 'legacy' : 'none' });
}, { immediate: true });

addListener(current => {
	const id = current.getFullname();
	if (!id) return;
	sessionStorage[lastSelectedKey] = id;
}, 'beforePaint');

addListener((current, previous) => {
	if (previous) {
		previous.entry.classList.remove('res-selected');
		previous.element.classList.remove('res-selected');
	}
	if (current) {
		current.entry.classList.add('res-selected');
		current.element.classList.add('res-selected');
	}
}, 'instantly');
