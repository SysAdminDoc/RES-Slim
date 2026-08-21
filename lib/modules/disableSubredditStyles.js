/* @flow */

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('disableSubredditStyles');

module.moduleName = 'disableSubredditStylesName';
module.category = 'appearanceCategory';
module.description = 'disableSubredditStylesDesc';
module.include = ['r2'];
module.keywords = ['subreddit style', 'subreddit stylesheet', 'theme', 'css'];

let observer: MutationObserver | null = null;

// Adapted from the GreasyFork userscript "Subreddit style remover":
// https://greasyfork.org/en/scripts/477625-subreddit-style-remover/code
// Reddit applies subreddit CSS via either an external <link rel="stylesheet" title="applied_subreddit_stylesheet">
// OR an inline <style title="applied_subreddit_stylesheet"> block, depending on size. We must strip both.
const STYLE_SELECTOR = 'link[title="applied_subreddit_stylesheet"], style[title="applied_subreddit_stylesheet"]';

function removeSubredditStyles() {
	for (const style of Array.from(document.querySelectorAll(STYLE_SELECTOR))) {
		if (style instanceof HTMLLinkElement || style instanceof HTMLStyleElement) {
			// Disable first so the browser drops the rules immediately, then
			// remove so any observer-driven re-apply from the upstream userscript
			// we borrowed the idea from can't re-enable it.
			style.setAttribute('disabled', 'disabled');
			style.remove();
		}
	}
}

function observeStylesheetInjection() {
	if (observer || !document.head) return;

	// The `| null` slot above was declared but never used, so a second call would
	// orphan the first observer while leaving it running — two observers doing the
	// same work, one of them unreachable.
	if (observer) observer.disconnect();
	observer = new MutationObserver(() => {
		removeSubredditStyles();
	});

	observer.observe(document.head, {
		childList: true,
		subtree: true,
	});

	removeSubredditStyles();
}

module.beforeLoad = () => {
	removeSubredditStyles();
	observeStylesheetInjection();
};

module.contentStart = () => {
	removeSubredditStyles();
	observeStylesheetInjection();
};
