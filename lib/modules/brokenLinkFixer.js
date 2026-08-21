/* @flow */
// RES-Slim: repair links old.reddit's markdown renderer escaped incorrectly.
//
// Concept from "Old Reddit Broken Link Fixer" (Greasy Fork 485253). The repair
// rules and the reason a blanket backslash strip is unsafe are in
// lib/utils/brokenLinks.js.

import { Module } from '../core/module';
import { watchForElements } from '../utils';
import { collectBrokenLinks, fixHref, isRedditHref } from '../utils/brokenLinks';

export const module: Module<{ [string]: any }> = new Module('brokenLinkFixer');

module.moduleName = 'Fix broken markdown links';
module.category = 'browsingCategory';
module.description = 'Repairs links whose target reddit escaped incorrectly, which is why some links with underscores or parentheses in them 404 even though the link text looks right. Wikipedia titles hit this constantly.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'commentsLinklist', 'profile', 'search', 'wiki', 'inbox'];
module.keywords = ['link', 'escape', 'backslash', 'underscore', '404', 'markdown'];

module.options = {
	redditLinksOnly: {
		type: 'boolean',
		value: false,
		title: 'Only repair links to reddit',
		description: 'Safer, but leaves the Wikipedia and imgur links that break most often. Turn this on only if a third-party link is being rewritten wrongly.',
	},
	markRepaired: {
		type: 'boolean',
		value: false,
		title: 'Mark repaired links',
		description: 'Adds a dotted underline so you can see which links were changed.',
	},
};

const ATTR = 'data-rsm-link-fixed';

function apply(anchor: HTMLAnchorElement, href: string) {
	anchor.setAttribute(ATTR, '1');
	anchor.setAttribute('href', href);
	if (module.options.markRepaired.value) {
		anchor.style.textDecoration = 'underline dotted';
		anchor.title = 'RES-Slim repaired this link';
	}
}

function sweep(root: Document | HTMLElement) {
	const redditOnly = module.options.redditLinksOnly.value === true;
	for (const { element, href } of collectBrokenLinks(root, redditOnly)) {
		if (element.hasAttribute(ATTR)) continue;
		apply(element, href);
	}
}

module.contentStart = () => {
	sweep(document);

	// New comments arrive from expandos, "load more comments", infiniteScroll and
	// the inbox. Repairing only what was in the first paint leaves those broken.
	watchForElements(['page'], 'a[href]', (anchor: HTMLElement) => {
		if (!(anchor instanceof HTMLAnchorElement)) return;
		if (anchor.hasAttribute(ATTR)) return;
		const raw = anchor.getAttribute('href');
		if (typeof raw !== 'string') return;
		if (module.options.redditLinksOnly.value === true && !isRedditHref(raw)) return;
		const href = fixHref(raw);
		if (href) apply(anchor, href);
	});
};
