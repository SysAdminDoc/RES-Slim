/* @flow */
// RES-Slim: hide posts from a user-defined list of subreddits on /r/all and /r/popular.
// Minimal replacement for a sliver of the removed filterReddit module.
// Inspired by hpaolini/reddit-all-blacklist (MIT).

import { Module } from '../core/module';
import { Thing, isCurrentSubreddit, watchForThings } from '../utils';

export const module: Module<*> = new Module('subredditBlacklist');

module.moduleName = 'Subreddit blacklist';
module.category = 'browsingCategory';
module.description = 'Hides posts from listed subreddits when browsing /r/all or /r/popular. Case-insensitive. Separate multiple with commas.';
module.descriptionRaw = true;
module.options = {
	blacklist: {
		type: 'text',
		value: '',
		title: 'Blacklist',
		description: 'Comma-separated list of subreddit names to hide on /r/all and /r/popular.',
	},
	alsoOnFrontPage: {
		type: 'boolean',
		value: false,
		title: 'Also filter on front page',
		description: 'Apply the blacklist on your home feed as well.',
	},
};

function parseList(): string[] {
	return module.options.blacklist.value
		.split(',')
		.map(s => s.trim().toLowerCase())
		.filter(Boolean);
}

function shouldRun(): boolean {
	if (isCurrentSubreddit('all') || isCurrentSubreddit('popular')) return true;
	if (module.options.alsoOnFrontPage.value && !isCurrentSubreddit()) return true;
	return false;
}

module.contentStart = () => {
	if (!shouldRun()) return;
	const list = parseList();
	if (!list.length) return;

	watchForThings(['post'], (thing: Thing) => {
		const sub = thing.getSubreddit();
		if (sub && list.includes(sub.toLowerCase())) {
			thing.element.style.display = 'none';
		}
	});
};
