/* @flow */

import { memoize, assignIn, once, pick } from './functional';
import { downcast } from './flow';
import { watchForThings } from './watchers';

// How long a waiter waits before it decides the thing is not coming. Long
// enough that a slow stream is not mistaken for a missing element, short enough
// that the observer is not attached for the life of the page.
export const DEFAULT_WAIT_TIMEOUT = 15000;

export type WaitOptions = {|
	// The caller saying it no longer cares. Not a defect, so it is not reported;
	// the promise rejects with a named error the caller is expected to swallow.
	// Nullable as well as optional: `getPageSignal()` answers null until core has
	// installed one, and a caller passing that through is asking for the same
	// unbounded behaviour it would have had anyway.
	+signal?: ?AbortSignal,
	// Milliseconds, or `Infinity` for the old unbounded behaviour. Opt out
	// deliberately and say why — unbounded is what this file is being fixed for.
	+timeout?: number,
	// Who is waiting. A timeout that names only a selector tells you what did not
	// appear and nothing about who was expecting it.
	+owner?: string,
|};

export function isAbortError(e: mixed): boolean {
	return e instanceof Error && e.name === 'RESWaitAborted';
}

function abortError(describe: string): Error {
	const error = new Error(`Stopped waiting for ${describe}`);
	error.name = 'RESWaitAborted';
	return error;
}

// Shared by every waiter below, because every one of them had the same three
// defects: no timeout, no rejection, and a `disconnect()` on the success path
// only. A selector that never appeared left a promise pending for the life of
// the page and a MutationObserver attached to the subtree, firing on every
// mutation — which on current Reddit, where the DOM streams continuously, is a
// permanent cost paid for an outcome that will never arrive. It is also why only
// two of 115 modules ever wrote to the module error log: nothing else could.
//
// `immediate` is checked before anything is observed, `attach` gets a `settle`
// it may call any number of times, and the teardown runs exactly once whichever
// way it ends.
function waitWith<T>(
	describe: string,
	{ signal, timeout = DEFAULT_WAIT_TIMEOUT, owner }: WaitOptions,
	immediate: () => ?T,
	// Anything with a `disconnect()`. A `MutationObserver` is the usual one; the
	// event waiter returns a teardown that removes its listeners, which is the
	// same contract from the outside. Read-only, because `MutationObserver`
	// declares its own `disconnect` that way and an exact writable shape does not
	// accept one.
	attach: (settle: (value: T) => void) => { +disconnect: () => void },
): Promise<T> {
	const found = immediate();
	if (found !== null && found !== undefined) return Promise.resolve(found);
	if (signal && signal.aborted) return Promise.reject(abortError(describe));

	return new Promise((resolve, reject) => {
		// Held on an object because `stop` has to exist before `attach` runs, and
		// the observer only exists after it.
		const held = {};
		let timer;
		let done = false;

		const stop = () => {
			if (done) return false;
			done = true;
			if (held.observer) held.observer.disconnect();
			if (timer !== undefined) clearTimeout(timer);
			if (signal) signal.removeEventListener('abort', onAbort);
			return true;
		};
		function onAbort() {
			if (stop()) reject(abortError(describe));
		}

		held.observer = attach(value => { if (stop()) resolve(value); });

		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		if (Number.isFinite(timeout)) {
			timer = setTimeout(() => {
				if (!stop()) return;
				reportWaitTimeout({ owner, describe, timeout });
				reject(new Error(`Timed out after ${timeout}ms waiting for ${describe}`));
			}, timeout);
		}
	});
}

export type WaitTimeout = {| +owner: ?string, +describe: string, +timeout: number |};

// `lib/utils/` may not import `lib/core/` — an eslint rule enforces it — and the
// module error log lives in core, behind storage. So core installs the reporter
// at startup and this file stays on its own side of the boundary.
//
// A default that does nothing is exactly the shape of the four unread mechanisms
// this codebase has already found, so `tests/unit/dom-waiters-contract.test.mjs`
// asserts the wiring exists and an e2e drives a real timeout through to the log.
let reportWaitTimeout: WaitTimeout => void = () => {};

// The signal open-ended waiters hang off, installed by core for the same reason
// the reporter above is: this file may not import `lib/core/`, and a page
// lifetime is a thing only core knows about. Absent until core starts, which is
// the unbounded behaviour these waiters had before — so a waiter created early
// is no worse off than it used to be.
let pageSignal: ?AbortSignal = null;

export function setPageSignal(signal: AbortSignal): void {
	pageSignal = signal;
}

export function getPageSignal(): ?AbortSignal {
	return pageSignal;
}

export function setWaitTimeoutReporter(report: WaitTimeout => void): void {
	reportWaitTimeout = report;
}

// Selectors in preference order. SponsorBlock keeps the same shape for the same
// reason — a site ships two markups at once during a rollout — except its version
// returns null silently, which is how a breakage reads as a feature quietly not
// running. A miss here times out and reports like any other.
function firstMatch(ele: Element, selectors: string[]): ?HTMLElement {
	for (const selector of selectors) {
		const found = ele.querySelector(selector);
		if (found instanceof HTMLElement) return found;
	}
	return null;
}

function asList(selector: string | string[]): string[] {
	return Array.isArray(selector) ? selector : [selector];
}

// One race, one teardown. This used to build a `Promise` per event, each
// removing only its own listener — so `waitForEvent(image, 'load', 'error')`
// left the losing listener attached to the element for as long as it lived, and
// the losing promise pending. Every multi-event call site had that shape, and
// `mediaTypes.js` alone has three.
//
// `timeout: Infinity` by default, deliberately. Most callers here are waiting on
// a person: a `mouseleave`, a `click`, a notification being dismissed. Those are
// legitimately unbounded, and a default timeout would reject a promise that
// several call sites do not catch. The bound available to a caller that wants
// one is the same `WaitOptions` every other waiter takes.
export function waitForEvent(ele: EventTarget, ...events: string[]): Promise<Event> {
	return waitForEventWith(ele, events, { timeout: Infinity });
}

export function waitForEventWith(ele: EventTarget, events: string[], options: WaitOptions = Object.freeze({})): Promise<Event> {
	return waitWith(
		`${events.join(' or ')} on ${ele instanceof Element ? ele.tagName.toLowerCase() : 'a target'}`,
		{ timeout: Infinity, ...options },
		() => null,
		settle => {
			const fire = (e: Event) => settle(e);
			for (const event of events) ele.addEventListener(event, fire);
			return { disconnect: () => { for (const event of events) ele.removeEventListener(event, fire); } };
		},
	);
}

export function waitForChild(ele: Element, selector: string | string[], options: WaitOptions = Object.freeze({})): Promise<HTMLElement> {
	const selectors = asList(selector);
	return waitWith(
		`a child matching ${selectors.join(' or ')}`,
		options,
		() => {
			const child = Array.from(ele.children).find(child => selectors.some(s => child.matches(s)));
			return child instanceof HTMLElement ? child : null;
		},
		settle => {
			const observer = new MutationObserver(mutations => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (node.nodeType === Node.ELEMENT_NODE && selectors.some(s => (node: any).matches(s))) {
							settle(downcast(node, HTMLElement));
							return;
						}
					}
				}
			});
			observer.observe(ele, { childList: true });
			return observer;
		},
	);
}

// The four watchers below return a disconnect. Nothing had to unsubscribe until
// `stopPageContextScript` grew an `undo()`: it restores the scripts it blocked
// and sets a `stopped` flag, but the observer over `head` or `#siteTable` stayed
// attached for the life of the page, waking on every added node to do nothing.
// Existing callers ignore the return, which is the same as before.
export function watchForChildren(ele: Element, selector: string, callback: (ele: HTMLElement) => any): () => void {
	for (const child of Array.from(ele.children).filter(child => child.matches(selector))) {
		callback(child);
	}

	return watchForFutureChildren(ele, selector, callback);
}

export function watchForFutureChildren(ele: Element, selector: string, callback: (ele: HTMLElement) => any): () => void {
	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE && (node: any).matches(selector)) {
					callback(downcast(node, HTMLElement));
				}
			}
		}
	});
	observer.observe(ele, { childList: true });
	return () => observer.disconnect();
}

export function waitForDescendant(ele: Element, selector: string | string[], options: WaitOptions = Object.freeze({})): Promise<HTMLElement> {
	const selectors = asList(selector);
	return waitWith(
		`a descendant matching ${selectors.join(' or ')}`,
		options,
		() => firstMatch(ele, selectors),
		settle => {
			const observer = new MutationObserver(mutations => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (node.nodeType === Node.ELEMENT_NODE) {
							// the desired node may be a descendant of an added node,
							// so scanning through addedNodes is not sufficient
							const child = firstMatch(ele, selectors);
							if (child) settle(child);
							// stop iteration now, since we've already run querySelector over all children
							return;
						}
					}
				}
			});
			observer.observe(ele, { childList: true, subtree: true });
			return observer;
		},
	);
}

export function waitForDescendantChange(ele: Element, selector: string, options: WaitOptions = Object.freeze({})): Promise<void> {
	return waitWith(
		`a change under ${selector}`,
		options,
		() => null,
		settle => {
			const observer = new MutationObserver(mutations => {
				for (const mutation of mutations) {
					if ((mutation.target: any).matches(selector)) return settle();
					for (const node of mutation.addedNodes) {
						if (node.nodeType === Node.ELEMENT_NODE && (node: any).querySelector(selector)) return settle();
					}
					for (const node of mutation.removedNodes) {
						if (node.nodeType === Node.ELEMENT_NODE && (node: any).querySelector(selector)) return settle();
					}
				}
			});
			observer.observe(ele, { childList: true, subtree: true });
			return observer;
		},
	);
}

// Both of these observe a subtree that outlives almost everything in it, and
// both used to take a `cancel` promise that could only ever resolve — so a
// caller that stopped caring in any other way left the observer attached. They
// now take the same `WaitOptions` every other waiter here does: a timeout, and
// an `AbortSignal` that is a real cancel rather than a promise nobody rejects.
export function waitForAttach(parent: HTMLElement, el: HTMLElement, options: WaitOptions = Object.freeze({})): Promise<void> {
	return waitWith(
		'an element to be attached',
		options,
		() => (parent.contains(el) ? true : null),
		settle => {
			const observer = new MutationObserver(() => { if (parent.contains(el)) settle(true); });
			observer.observe(parent, { subtree: true, childList: true });
			return observer;
		},
	).then(() => {});
}

export function waitForDetach(el: HTMLElement, options: WaitOptions = Object.freeze({})): Promise<void> {
	// Use `document.documentElement` as parent since using other closer element may not detect removal
	const parent = document.documentElement;

	return waitWith(
		'an element to be detached',
		// An element that is never removed is the ordinary case, not a defect, so
		// this one is bounded by its signal rather than by the clock. A timeout
		// would report a missing element every time a hover target simply stayed
		// on the page.
		{ timeout: Infinity, ...options },
		() => (parent.contains(el) ? null : true),
		settle => {
			const observer = new MutationObserver(() => { if (!parent.contains(el)) settle(true); });
			observer.observe(parent, { subtree: true, childList: true });
			return observer;
		},
	).then(() => {});
}

// `e.target instanceof Element && e.target.closest(sel)` was written out at five
// call sites, and every one of them then dereferenced `.dataset`, `.style` or
// `.offsetTop` on the result — none of which exist on `Element`. The DOM is right
// to withhold them (an SVG element has no `.dataset`), so the fix is to narrow
// once, here, and return null rather than an element the caller cannot use.
//
// Returns null for a non-Element target, no match, or a match that is not an
// HTMLElement. A caller that wants the SVG case should use `closest` directly.
export function closestHtml(target: ?EventTarget, selector: string): ?HTMLElement {
	if (!(target instanceof Element)) return null;
	const found = target.closest(selector);
	return found instanceof HTMLElement ? found : null;
}

export function watchForDescendants(ele: Element, selector: string, callback: (ele: HTMLElement) => any, ignoreChildrenIfAddedNodeMatches: boolean = false): () => void {
	for (const child of ele.querySelectorAll(selector)) {
		callback(child);
	}

	return watchForFutureDescendants(ele, selector, callback, ignoreChildrenIfAddedNodeMatches);
}

export function watchForFutureDescendants(ele: Element, selector: string, callback: (ele: HTMLElement) => any, ignoreChildrenIfAddedNodeMatches: boolean = false): () => void {
	const observer = new MutationObserver(mutations => {
		// avoid calling the callback twice if streamed-in children match the same selectors as their parents
		// i.e. nested comments that are rendered at pageload
		const children = new Set();
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					// the node itself may match...
					if ((node: any).matches(selector)) {
						children.add(node);
						if (ignoreChildrenIfAddedNodeMatches) continue;
					}
					// ...or some of its children may match
					for (const child of (node: any).querySelectorAll(selector)) {
						children.add(child);
					}
				}
			}
		}
		for (const child of children) {
			callback(downcast(child, HTMLElement));
		}
	});
	observer.observe(ele, { childList: true, subtree: true });
	return () => observer.disconnect();
}

// Limitation: Only runs check when `ele`''s attributes are changed
//
// `timeout: Infinity` by default, because the only caller waits for a post's
// expando to stop being uninitialised — which happens when the reader expands
// it, or never. A clock cannot tell those apart, and reporting a missing element
// for every link post nobody opened would bury the timeouts that mean something.
//
// The leak is the part that was wrong: one attribute observer and one pending
// async frame per link post, for the life of the page, accumulating across an
// infinite scroll. The signal is what lets go of them.
export function waitForSelectorMatch(ele: HTMLElement, selector: string, options: WaitOptions = Object.freeze({})): Promise<void> {
	return waitWith(
		`${selector} to match`,
		{ timeout: Infinity, ...options },
		() => (ele.matches(selector) ? true : null),
		settle => {
			const observer = new MutationObserver(() => { if (ele.matches(selector)) settle(true); });
			observer.observe(ele, { attributes: true });
			return observer;
		},
	).then(() => {});
}

export function empty<T: Element>(parent: T): T {
	while (parent.lastChild) parent.removeChild(parent.lastChild);
	return parent;
}

export function click(obj: EventTarget, button: number = 0): void {
	obj.dispatchEvent(new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
		detail: 0,
		screenX: 1,
		screenY: 1,
		clientX: 1,
		clientY: 1,
		button,
	}));
}

click.isProgrammaticEvent = (e: MouseEvent): boolean => e.clientX === 1 && e.clientY === 1;

export const getViewportSize = memoize((): { width: number, height: number } => {
	waitForEvent(window, 'resize').then(() => { getViewportSize.cache.clear(); });

	let visualViewport;

	if (window.visualViewport) {
		visualViewport = window.visualViewport;
	} else {
		const viewportSizedElement = document.createElement('div');
		viewportSizedElement.style.width = viewportSizedElement.style.height = '100%';
		viewportSizedElement.style.position = 'fixed';
		document.body.appendChild(viewportSizedElement);
		visualViewport = viewportSizedElement.getBoundingClientRect();

		// Try less accurate method in case this didn't work (workaround for potensial Firefox issue)
		if (!visualViewport.height || !visualViewport.width) {
			visualViewport = document.documentElement.getBoundingClientRect();
		}

		viewportSizedElement.remove();
	}

	return pick(visualViewport, ['height', 'width']);
});

export function elementInViewport(ele: HTMLElement): boolean {
	if (!ele || !ele.offsetParent) return false;

	const { top, left, bottom, right } = ele.getBoundingClientRect();

	return (
		top >= 0 &&
		left >= 0 &&
		bottom <= getViewportSize().height &&
		right <= getViewportSize().width
	);
}

function getViewportDimensions() {
	const headerOffset = getHeaderOffset();
	const left = window.pageXOffset;
	const top = window.pageYOffset + headerOffset;
	const width = getViewportSize().width;
	const height = getViewportSize().height - headerOffset;

	return {
		yOffset: headerOffset,
		left,
		top,
		bottom: top + height,
		right: left + width,
		width,
		height,
	};
}

// Returns percentage of the element that is within the viewport along the y-axis
// Note that it doesn't matter where the element is on the x-axis, it can be totally invisible to the user
// and this function might still return 1!
export function getPercentageVisibleYAxis(obj: Element): number {
	const rect = obj.getBoundingClientRect();
	const top = Math.max(0, rect.bottom - rect.height);
	const bottom = Math.min(getViewportSize().height, rect.bottom);
	if (rect.height === 0) {
		return 0;
	}
	return Math.max(0, (bottom - top) / rect.height);
}

const padBottom = once(() => {
	const element = document.createElement('div');
	element.style.clear = 'both';
	const extraPadding = 50; // In case the body's height reduces
	return (scrollTop, viewportHeight) => {
		const currentPadding = element.clientHeight;
		const paddingRequired = extraPadding +
			-(document.documentElement.scrollHeight - scrollTop - viewportHeight - currentPadding);
		if (paddingRequired > 0) document.body.append(element);
		else element.remove();
		element.style.height = `${paddingRequired}px`;
	};
});

let recentScroll = false;
let scrollInvokationToken;

export type ScrollStyle = 'none' | 'top' | 'adopt' | 'middle' | 'page' | 'legacy' | 'directional';
type Direction = 'up' | 'down';
type Anchor = {| to: number, from?: number |};

export function scrollToElement(to: HTMLElement, from: ?HTMLElement, {
	scrollStyle,
	restrictDirectionTo,
	direction: selectedDirection,
	anchor,
	waitTillVisible,
}: {|
	scrollStyle: ScrollStyle,
	restrictDirectionTo?: Direction,
	direction?: Direction,
	anchor?: Anchor,
	waitTillVisible?: boolean,
|}) {
	const _scrollInvokationToken = scrollInvokationToken = {}; // Unique object used to check this whether invokation has been superseded

	if (scrollStyle === 'none' && !anchor) {
		return;
	}

	if (waitTillVisible && !to.offsetParent) {
		// Try again next frame
		requestAnimationFrame(() => {
			if (scrollInvokationToken === _scrollInvokationToken) scrollToElement(...arguments); // eslint-disable-line prefer-rest-params
		});
		return;
	}

	if (!to.offsetParent) {
		console.error('Element is not visible.');
		return;
	}

	if (scrollStyle === 'none' && anchor) {
		const diff = to.getBoundingClientRect().top - anchor.to;
		if (diff) window.scrollBy(0, diff);
	}

	const viewport = getViewportDimensions();

	const target = assignIn({}, to.getBoundingClientRect()); // top, right, bottom, left are relative to viewport
	target.top -= viewport.yOffset;
	target.bottom -= viewport.yOffset;

	const top = viewport.top + target.top - 5; /* offset */

	if (scrollStyle === 'middle' && target.height >= viewport.height) {
		scrollStyle = 'top';
	}

	let compensateHeader = true;
	let scrollY;

	if (scrollStyle === 'top') {
		// Always scroll element to top of page; pad bottom if necessary
		padBottom()(top, viewport.height);
		scrollY = top;
	} else if (from && scrollStyle === 'adopt') {
		// Replace the viewport position of `from` with `element`
		const fromTop = anchor && typeof anchor.from === 'number' ?
			anchor.from :
			from.getBoundingClientRect().top;
		let diff = to.getBoundingClientRect().top - fromTop;

		if (fromTop < 0) {
			// Compensate to show top when it is above viewport
			diff += fromTop;
		} else if (fromTop > viewport.height - 60) {
			// Always show at minimum the top 60px of the element
			diff += fromTop - viewport.height + 60;
		}

		scrollY = window.scrollY + diff;
		compensateHeader = false;
	} else if (scrollStyle === 'middle') {
		const buffer = (viewport.height - target.height) / 2;
		const newScrollY = top - buffer;

		if (elementInViewport(to)) {
			const viewportDirection = newScrollY >= window.scrollY ? 'down' : 'up';
			// Having these go in opposite directions is jarring
			if (viewportDirection !== selectedDirection) return;
		}

		scrollY = newScrollY;
	} else if (target.top >= 0 && target.bottom <= viewport.height) {
		// Element is already completely inside viewport
		// (remember, top and bottom are relative to viewport)
		// do nothing
	} else if (scrollStyle === 'legacy') {
		// Element not completely in viewport, so scroll to top
		scrollY = top;
	} else if (target.top < viewport.yOffset) {
		// Element starts above viewport
		// So, align top of element to top of viewport
		scrollY = top;
	} else if (viewport.height < target.bottom &&
		target.height < viewport.height) {
		// Visible part of element starts or extends below viewport
		if (scrollStyle === 'page') {
			scrollY = top;
		} else {
			// So, align bottom of target to bottom of viewport
			scrollY = viewport.top + target.bottom - viewport.height;
		}
	} else {
		// Visible part of element below the viewport but it'll fill the viewport, or fallback
		// So, align top of element to top of viewport
		scrollY = top;
	}

	if (scrollY !== undefined) {
		if (compensateHeader) scrollY -= getHeaderOffset();
		const scollDirection = scrollY > viewport.top ? 'down' : 'up';
		if (viewport.top === scrollY || (restrictDirectionTo && restrictDirectionTo !== scollDirection)) return;
		window.scrollTo(0, scrollY);
		recentScroll = true;
		waitForEvent(window, 'scroll').then(() => { recentScroll = false; });
	}
}

scrollToElement.isProgrammaticEvent = (): boolean => recentScroll;

// How much of the top of the viewport a sticky header is covering.
//
// This used to sum the heights of elements registered through `_addHeaderId`.
// Nothing ever called that function - not one caller in `lib`, `tests` or
// `scripts`, and it was not even in the `lib/utils` barrel - so the list was
// always empty and this always returned exactly 0. Three call sites compensated
// by nothing: `getViewportDimensions`, `scrollToElement`'s `compensateHeader`
// (which defaults to true), and the floater's top edge. With the refined layout
// on by default and `#header` sticky at a measured 80-172px, every scroll this
// function was meant to correct landed the target underneath the header.
//
// `scroll-padding-block-start` already covers the CSS side, which is why
// `scrollIntoView` behaves - but `scrollToElement` ends in `window.scrollTo`,
// and scroll padding does not apply to that.
//
// Rather than reintroduce a registration nobody performs, this reads the height
// `pageTheme` already measures and publishes for that scroll padding. Reading
// the *inline* property rather than the computed one is deliberate: that is
// where it is written, and it costs a property read instead of a style flush on
// a path that runs during scrolling. It is naturally 0 when no theme is applied,
// which is correct, because then there is no sticky header either.
const HEADER_HEIGHT_PROPERTY = '--rsm-th-header-height';

export function getHeaderOffset(): number {
	const root = document.documentElement;
	if (!root) return 0;
	const published = parseInt(root.style.getPropertyValue(HEADER_HEIGHT_PROPERTY), 10);
	return Number.isFinite(published) && published > 0 ? published : 0;
}

export const getD2xBodyOffset = memoize(() => {
	try {
		return document.getElementById('2x-container').offsetTop;
	} catch (e) {
		return 65;
	}
});

export function addCSS(css: string) {
	let style = addStyle(css);
	return {
		remove() {
			if (!style) return;
			style.remove();
			style.textContent = '';
			style = undefined;
		},
	};
}

function addStyle(css) {
	const style = document.createElement('style');
	style.textContent = css;

	(document.head || document.documentElement).appendChild(style);

	return style;
}

export const isLastNodeInDOM = (node: Node) => {
	let _last = node;
	do {
		if (_last.nextSibling) break;
	} while ((_last = _last.parentNode));
	return !_last;
};

// r2 Reddit clone certain elements, e.g. when replying or editing a post
// This will remove elements that have a specific attribute, but have not been registered
export const preventCloning = (() => {
	// Prevent breaking ava test
	if (typeof window === 'undefined') return (e: *) => e;

	const attribute = `res-prevent-cloning-${Date.now()}`; // Include date to prevent the attribute being misused in a selector
	const elements = new WeakSet();

	// Delay adding the observer a little, to not slow down init
	// Things are practially never cloned _before_ the page is fully loaded, so this is a OK solutoin
	waitForEvent(window, 'DOMContentLoaded', 'load').then(() => {
		watchForThings(null, thing => {
			for (const ele of [...thing.entry.querySelectorAll(`[${attribute}]`)]) { if (!elements.has(ele)) ele.remove(); }
		}, { immediate: true });
	});

	return (element: HTMLElement) => {
		element.setAttribute(attribute, '');
		elements.add(element);
		return element;
	};
})();
