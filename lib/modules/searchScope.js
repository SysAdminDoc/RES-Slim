/* @flow */
// RES-Slim: make reddit's search remember how you want it scoped.
//
// Combines three single-purpose userscripts — "Reddit force local search",
// "Reddit - Always disable safe search" and "reddit legacy search feature" —
// because reddit drops all three settings on every form submit and fixing one
// without the others still means re-ticking boxes.
//
// URL rewriting lives in lib/utils/searchScope.js, including why restrict_sr
// must not be applied to a site-wide search.

import { Module } from '../core/module';
import { isPageType, watchForElements } from '../utils';
import { applySearchScope, isSearchUrl, isSubredditSearch } from '../utils/searchScope';

export const module: Module<{ [string]: any }> = new Module('searchScope');

module.moduleName = 'Search scope defaults';
module.category = 'browsingCategory';
module.description = 'Applies your preferred search scoping every time: keep a subreddit search inside that subreddit, stop excluding adult results, and request the legacy search backend. Reddit resets all three on each submit.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['search', 'restrict', 'subreddit', 'safe search', 'legacy', 'nsfw'];

module.options = {
	restrictToSubreddit: {
		type: 'boolean',
		value: true,
		title: 'Keep subreddit searches inside the subreddit',
		description: 'Ticks "limit my search to r/<sub>" by default when you search from within a subreddit. Has no effect on a site-wide search.',
	},
	includeOver18: {
		type: 'boolean',
		value: false,
		title: 'Include adult results',
		description: 'Reddit filters them out by default on every search, even for accounts that have adult content enabled.',
	},
	legacySearch: {
		type: 'boolean',
		value: false,
		title: 'Request the legacy search backend',
		description: 'Adds <code>feature=legacy_search</code>. The old backend honors quoted phrases and field queries that the current one silently ignores.',
	},
};

function options() {
	return {
		restrictToSubreddit: module.options.restrictToSubreddit.value === true,
		includeOver18: module.options.includeOver18.value === true,
		legacySearch: module.options.legacySearch.value === true,
	};
}

function anyEnabled(): boolean {
	const o = options();
	return o.restrictToSubreddit || o.includeOver18 || o.legacySearch;
}

// The search form posts as a GET, so the scoping has to be present as form
// fields — rewriting only the action URL loses them the moment the browser
// serialises the form.
function fixForms() {
	const o = options();
	for (const form of document.querySelectorAll('form#search, form.search-form')) {
		if (!(form instanceof HTMLFormElement)) continue;

		const action = form.getAttribute('action') || location.pathname;
		const scoped = isSubredditSearch(action) || isSubredditSearch(location.pathname);

		const setField = (name: string, value: string) => {
			let field = form.querySelector(`input[name="${name}"]`);
			if (!(field instanceof HTMLInputElement)) {
				field = document.createElement('input');
				field.type = 'hidden';
				field.name = name;
				form.append(field);
			}
			// reddit renders restrict_sr as a real checkbox on subreddit search
			// pages; setting `.value` on a checkbox does nothing, it has to be
			// checked instead.
			if (field.type === 'checkbox') field.checked = true;
			else field.value = value;
		};

		if (o.restrictToSubreddit && scoped) setField('restrict_sr', 'on');
		if (o.includeOver18) setField('include_over_18', 'on');
		if (o.legacySearch) setField('feature', 'legacy_search');
	}
}

// Sort tabs and time-window links on a results page are plain anchors that carry
// the current query but not the scoping, so clicking one throws it away.
function fixResultLinks(root: Document | HTMLElement) {
	const o = options();
	for (const link of root.querySelectorAll('a[href*="search"]')) {
		if (!(link instanceof HTMLAnchorElement)) continue;
		if (link.hasAttribute('data-rsm-search-scoped')) continue;
		const href = link.getAttribute('href');
		if (typeof href !== 'string' || !isSearchUrl(href)) continue;
		const scoped = applySearchScope(href, o);
		if (scoped === href) continue;
		link.setAttribute('data-rsm-search-scoped', '1');
		link.setAttribute('href', scoped);
	}
}

module.contentStart = () => {
	if (!anyEnabled()) return;

	fixForms();
	if (isPageType('search')) {
		fixResultLinks(document);
		watchForElements(['page'], 'a[href*="search"]', (el: HTMLElement) => {
			if (el.parentElement) fixResultLinks(el.parentElement);
		});
	}
};
