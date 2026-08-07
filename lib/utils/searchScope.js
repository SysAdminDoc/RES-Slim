/* @flow */

// Rewrite a reddit search URL to carry the scoping the user actually wanted.
//
// Three long-lived userscripts each fix one third of this and none of them
// survive a page navigation: "Reddit force local search" (restrict_sr),
// "Reddit - Always disable safe search" (include_over_18) and "reddit legacy
// search feature" (feature=legacy_search). They are one setting apiece because
// each was written against a different reddit regression; combining them is
// strictly better, because reddit drops all three on every form submit.

export type SearchScopeOptions = {|
	restrictToSubreddit: boolean,
	includeOver18: boolean,
	legacySearch: boolean,
|};

export const SEARCH_PATH = /^\/(?:r\/[^/]+\/)?search\/?$/;

export function isSearchUrl(url: string): boolean {
	try {
		return SEARCH_PATH.test(new URL(url, 'https://old.reddit.com').pathname);
	} catch (e) {
		return false;
	}
}

// True when the search URL is scoped to a subreddit at all. `restrict_sr` on a
// site-wide /search is meaningless and reddit answers it with zero results, so
// the option must not be applied there — that is the bug in the original script.
export function isSubredditSearch(url: string): boolean {
	try {
		return /^\/r\/[^/]+\/search\/?$/.test(new URL(url, 'https://old.reddit.com').pathname);
	} catch (e) {
		return false;
	}
}

export function applySearchScope(url: string, options: SearchScopeOptions): string {
	let parsed;
	try {
		parsed = new URL(url, 'https://old.reddit.com');
	} catch (e) {
		return url;
	}
	if (!SEARCH_PATH.test(parsed.pathname)) return url;

	const params = parsed.searchParams;

	if (options.restrictToSubreddit && isSubredditSearch(parsed.pathname)) {
		params.set('restrict_sr', 'on');
	}
	if (options.includeOver18) {
		params.set('include_over_18', 'on');
	}
	if (options.legacySearch) {
		params.set('feature', 'legacy_search');
	}

	// Keep the output relative when the input was — rewriting a form action to an
	// absolute URL changes which host the form posts to if reddit ever serves the
	// page from a different subdomain.
	const search = params.toString();
	if (/^https?:/i.test(url)) {
		parsed.search = search;
		return parsed.toString();
	}
	return `${parsed.pathname}${search ? `?${search}` : ''}${parsed.hash}`;
}
