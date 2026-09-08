/* @flow */

import { Module } from '../core/module';
import { execRegexes, regexes, Thing } from '../utils';

export const module: Module<{ [string]: any }> = new Module('commentDepth');

module.moduleName = 'commentDepthName';
module.category = 'commentsCategory';
module.disabledByDefault = true;
module.description = 'commentDepthDesc';
// Scoped to old reddit. With no include, no exclude and no asLongAs predicate this ran on
// every page the content script touches, including the extension's own options
// page — the same omission fixed one module at a time in v0.3.5 and v0.4.0.
module.include = ['r2'];

module.options = {
	defaultCommentDepth: {
		type: 'text',
		value: '4',
		description: 'commentDepthDefaultCommentDepthDesc',
		title: 'commentDepthDefaultCommentDepthTitle',
	},
	defaultMinimumComments: {
		type: 'text',
		value: '50',
		description: 'commentDepthDefaultMinimumCommentsDesc',
		title: 'commentDepthDefaultMinimumCommentsTitle',
	},
	commentPermalinks: {
		type: 'boolean',
		value: false,
		description: 'commentDepthCommentPermaLinksDesc',
		title: 'commentDepthCommentPermaLinksTitle',
	},
	commentPermalinksContext: {
		dependsOn: options => options.commentPermalinks.value,
		type: 'boolean',
		value: false,
		description: 'commentDepthCommentPermalinksContextDesc',
		title: 'commentDepthCommentPermalinksContextTitle',
	},
	subredditCommentDepths: {
		type: 'table',
		addRowText: 'commentDepthAddSubreddit',
		fields: [{
			key: 'subreddits',
			name: 'commentDepthSubreddit',
			type: 'list',
			listType: 'subreddits',
		}, {
			key: 'commentDepth',
			name: 'commentDepthCommentDepth',
			type: 'text',
			value: '4',
		}, {
			key: 'minimumComments',
			name: 'commentDepthMinimumComments',
			type: 'text',
			value: '50',
		}],
		value: ([]: Array<[string, string, string]>),
		description: 'commentDepthSubredditCommentDepthsDesc',
		title: 'commentDepthSubredditCommentDepthsTitle',
	},
};

// One table cell, as the subreddits it names.
//
// `parseSubredditList` was the obvious reuse here and is the wrong tool: it
// validates each entry against reddit's `[A-Za-z0-9_]{2,21}` name rule, and the
// value these are compared against does not obey it. `execRegexes.comments`
// captures `[\w.]+` -- the dot is there for `r/reddit.com`, the legacy subreddit
// -- and rewrites `/user/<name>/comments/` into `u_<name>`, which at reddit's
// 20-character username limit is 22 and over the cap. Both were matching before
// and both stopped.
//
// So: trim, drop empties, and accept the shapes a list arrives in when it is
// copied rather than typed. No opinion about what a subreddit may be called;
// anything that is not one simply matches nothing.
const SUBREDDIT_PREFIX = /^(?:https?:\/\/[^/]*reddit\.com)?\/?r\//i;

function listedSubreddits(cell: mixed): string[] {
	return String(cell === null || cell === undefined ? '' : cell)
		.split(/[\n,]/)
		.map(entry => entry.trim().replace(SUBREDDIT_PREFIX, '').replace(/\/+$/, '').toLowerCase())
		.filter(Boolean);
}

module.contentStart = () => {
	document.body.addEventListener('mousedown', (e: Event) => {
		const link = e.target instanceof Element && e.target.closest('a[href*="/comments"]');
		if (!link) return;
		const target: HTMLAnchorElement = (link: any);
		const url = new URL(target.href, location.href);

		// no need to proceed if depth already exists in the query string
		if (url.searchParams.has('depth')) return;

		if (regexes.commentPermalink.test(url.pathname)) {
			if (!module.options.commentPermalinks.value) return;
			if (!module.options.commentPermalinksContext.value && url.searchParams.has('context')) return;
		}

		const matches = execRegexes.comments(url.pathname);
		if (!matches) return;

		// Both capture groups are optional, so a bare `/comments/<id>` shortlink
		// leaves this undefined and `.toLowerCase()` threw out of the listener --
		// which meant the depth was silently not applied and an error was logged on
		// every mousedown. An empty name matches no row, so the defaults apply,
		// which is the right answer for a link that does not say which subreddit it
		// is in.
		const subreddit = (matches[1] || '').toLowerCase();

		// check for subreddit specific values. This used to split the cell on
		// commas and compare the pieces directly, so `askreddit, pics` applied to
		// askreddit only: the second entry was " pics", with a leading space.
		const [, commentDepth, minimumComments] = (
			module.options.subredditCommentDepths.value.find(([subreddits]) => listedSubreddits(subreddits).includes(subreddit)) ||
			[null, module.options.defaultCommentDepth.value, module.options.defaultMinimumComments.value]
		);

		// NaN or 0 (show everything)
		if (!parseInt(commentDepth, 10)) return;

		const minimumCount = parseInt(minimumComments, 10);
		if (minimumCount) {
			const thing = Thing.from(e.currentTarget);
			if (thing && thing.isPost() && (thing.getCommentCount() || 0) < minimumCount) return;
		}

		url.searchParams.set('depth', commentDepth);
		target.removeAttribute('data-inbound-url');
		target.href = url.href;
	});
};
