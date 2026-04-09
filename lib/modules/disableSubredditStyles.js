/* @flow */

import { Module } from '../core/module';

export const module: Module<*> = new Module('disableSubredditStyles');

module.moduleName = 'disableSubredditStylesName';
module.category = 'appearanceCategory';
module.description = 'disableSubredditStylesDesc';
module.include = ['r2'];
module.keywords = ['subreddit style', 'subreddit stylesheet', 'theme', 'css'];

let observer: MutationObserver | null = null;

// Adapted from the GreasyFork userscript "Subreddit style remover":
// https://greasyfork.org/en/scripts/477625-subreddit-style-remover/code
const STYLE_SELECTOR = 'link[title="applied_subreddit_stylesheet"], link[ref="applied_subreddit_stylesheet"]';

function removeSubredditStyles() {
	for (const style of Array.from(document.querySelectorAll(STYLE_SELECTOR))) {
		if (style instanceof HTMLLinkElement) {
			style.setAttribute('disabled', 'disabled');
			style.remove();
		}
	}
}

function observeStylesheetInjection() {
	if (observer || !document.head) return;

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
