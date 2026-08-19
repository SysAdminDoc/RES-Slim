/* @flow */

import { waitFor } from './async';
import { waitForChild, waitForEvent, waitForDescendant } from './dom';

// No timeout: a document that never grows a body has nothing for this extension
// to do, and rejecting here would take every phase below it down with no gain.
export const bodyStart: Promise<*> = waitForChild(document.documentElement, 'body', { timeout: Infinity })
	// `document.body === null` at this point has been reported for users of Firefox and Chrome,
	// so wait till the reference has been updated before progressing
	.then(() => waitFor(() => document.body, 10));

export const contentStart: Promise<*> = bodyStart
	.then(() => {
		// `#siteTable` is an old-Reddit element and never appears on current
		// Reddit, so this waiter used to hold a subtree MutationObserver on
		// `document.body` for the life of the page — firing on every streamed post
		// — for a result `contentLoaded` had already produced. The signal is its
		// bound rather than a timeout, because a timeout would report a missing
		// element on every current-Reddit page and there is nothing wrong there.
		const stopLooking = new AbortController();
		const siteTable = waitForDescendant(document.body, '#siteTable', { signal: stopLooking.signal, timeout: Infinity });
		// Losing the race is the expected outcome on one of the two renderers.
		siteTable.catch(() => {});
		return Promise.race([siteTable, contentLoaded]).finally(() => { stopLooking.abort(); });
	});

export const contentLoaded: Promise<*> = bodyStart
	.then(() => Promise.race([
		waitForEvent(window, 'DOMContentLoaded', 'load'),
		waitFor(() => document.readyState === 'interactive' || document.readyState === 'complete', 500),
	]));

export const loadComplete: Promise<*> = bodyStart
	.then(() => Promise.race([
		waitForEvent(window, 'load'),
		waitFor(() => document.readyState === 'complete', 500),
	]));

