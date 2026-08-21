/* @flow */
// RES-Slim: put a "random" link back in the header.
//
// Concept from "Restore Random Subreddit Feature" (Greasy Fork 528662). That
// script calls redditrand.com, a third-party service, to pick the subreddit —
// which sends your browsing to someone else's host for a feature reddit still
// serves itself. /r/random and /r/randnsfw are both live; the reason people
// think the feature is gone is that reddit removed the link, not the endpoint.
//
// So there is no outbound call here at all: the link points at reddit.

import { Module } from '../core/module';
import { string } from '../utils';
import { findSurface } from '../core/dom/selectors';

export const module: Module<{ [string]: any }> = new Module('randomSubreddit');

module.moduleName = 'Random subreddit link';
module.category = 'subredditsCategory';
module.description = 'Adds a "random" link to the subreddit bar that drops you into a random subreddit. Points at reddit\'s own /r/random endpoint — no third-party service is contacted.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['random', 'subreddit', 'discover', 'explore'];

module.options = {
	target: {
		type: 'enum',
		value: 'random',
		values: [
			{ name: 'Any subreddit (/r/random)', value: 'random' },
			{ name: 'NSFW subreddits (/r/randnsfw)', value: 'randnsfw' },
		],
		title: 'Which pool',
		description: '/r/randnsfw requires an account with NSFW content enabled; reddit answers with a redirect to the front page otherwise.',
	},
	openInNewTab: {
		type: 'boolean',
		value: false,
		title: 'Open in a new tab',
		description: 'Keeps the page you are on.',
	},
};

const LINK_CLASS = 'rsm-randomSubreddit-link';

function injectLink() {
	// The subreddit bar is where reddit's own "random" link used to live.
	const bar = findSurface('subredditBar') || document.querySelector('#sr-header-area .sr-bar');
	if (!(bar instanceof HTMLElement)) return;
	if (bar.querySelector(`.${LINK_CLASS}`)) return;

	const target = module.options.target.value === 'randnsfw' ? '/r/randnsfw' : '/r/random';
	const link = string.html`<a href="${target}" class="${LINK_CLASS}">random</a>`;
	link.setAttribute('aria-label', 'Go to a random subreddit');
	link.title = 'Go to a random subreddit';
	if (module.options.openInNewTab.value) {
		link.target = '_blank';
		// Without this the opened tab can reach back through window.opener.
		link.rel = 'noopener noreferrer';
	}

	const separator = document.createElement('span');
	separator.className = 'separator';
	separator.textContent = '-';

	bar.append(separator, link);
}

module.contentStart = () => {
	injectLink();
};
