/* @flow */
// RES-Slim: make flair clickable.
//
// Concept from "Reddit Flair Linkifier" (Greasy Fork 493549) and "MAL flair to
// link". On old.reddit a post's flair is inert text even though reddit indexes
// it — `flair_name:"..."` is a supported search field. Query construction and
// the quoting rule are in lib/utils/flairSearch.js.

import { Module } from '../core/module';
import { Thing, currentSubreddit, watchForThings } from '../utils';
import { flairSearchUrl, userInSubredditSearchUrl } from '../utils/flairSearch';

export const module: Module<{ [string]: any }> = new Module('flairLinkify');

module.moduleName = 'Clickable flair';
module.category = 'subredditsCategory';
module.description = 'Turns post flair into a link that searches the subreddit for every post carrying it, and user flair into a link to that person\'s posts in the same subreddit.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'commentsLinklist', 'search'];
module.disabledByDefault = true;
module.keywords = ['flair', 'link', 'search', 'filter', 'tag'];

module.options = {
	linkPostFlair: {
		type: 'boolean',
		value: true,
		title: 'Link post flair',
		description: 'Searches the subreddit for that flair.',
	},
	linkUserFlair: {
		type: 'boolean',
		value: false,
		title: 'Link user flair',
		description: 'User flair is not indexed, so this links to that author\'s posts in the subreddit instead. That\'s useful where flair marks a role.',
	},
	openInNewTab: {
		type: 'boolean',
		value: true,
		title: 'Open in a new tab',
		description: 'Keeps the listing you were reading.',
	},
};

const ATTR = 'data-rsm-flair-linked';

function subredditFor(thing: Thing): ?string {
	// On a subreddit page every row belongs to it; on /r/all and multireddits the
	// row carries its own. Prefer the row's, because a flair search against the
	// wrong subreddit returns nothing and looks like the feature is broken.
	return thing.getSubreddit() || currentSubreddit();
}

function linkify(element: HTMLElement, href: string, title: string) {
	if (element.hasAttribute(ATTR)) return;
	element.setAttribute(ATTR, '1');

	const anchor = document.createElement('a');
	anchor.href = href;
	anchor.title = title;
	anchor.style.color = 'inherit';
	anchor.style.textDecoration = 'none';
	anchor.setAttribute('aria-label', title);
	if (module.options.openInNewTab.value) {
		anchor.target = '_blank';
		anchor.rel = 'noopener noreferrer';
	}

	// Wrap in place rather than rebuilding: subreddit stylesheets style the flair
	// span itself, and replacing it drops that styling.
	const parent = element.parentNode;
	if (!parent) return;
	parent.insertBefore(anchor, element);
	anchor.append(element);
}

function processThing(thing: Thing) {
	const subreddit = subredditFor(thing);
	if (!subreddit) return;

	if (module.options.linkPostFlair.value) {
		const flairEl = thing.getPostFlairElement();
		const label = thing.getPostFlairText();
		const href = flairSearchUrl(subreddit, label);
		if (flairEl instanceof HTMLElement && href) {
			linkify(flairEl, href, `Search r/${subreddit} for posts flaired "${String(label).trim()}"`);
		}
	}

	if (module.options.linkUserFlair.value) {
		const flairEl = thing.getUserFlairElement();
		const author = thing.getAuthor();
		const href = userInSubredditSearchUrl(subreddit, author);
		if (flairEl instanceof HTMLElement && href) {
			linkify(flairEl, href, `Search r/${subreddit} for posts by ${String(author)}`);
		}
	}
}

module.contentStart = () => {
	watchForThings(['post', 'comment'], processThing);
};
