/* @flow */

import { partition, once, memoize, memoizeUnsettled } from './functional';
import { waitForEvent } from './dom';
import { appPageTypes, d2xPageTypeAttributes, d2xRouteNames, regexes } from './location';
import type { AppType, PageType } from './location';

export function matchesPageLocation(includes: Array<PageType | AppType | RegExp>, excludes: Array<PageType | AppType | RegExp> = []): boolean {
	const [includeStrings, includeRegExps]: any = partition(includes, (x: string | RegExp): boolean => typeof x === 'string');
	const [excludeStrings, excludeRegExps]: any = partition(excludes, (x: string | RegExp): boolean => typeof x === 'string');

	return (
		!excludes.length ||
		!(isPageType(...excludeStrings) || isAppType(...excludeStrings) || matchesPageRegex(...excludeRegExps))
	) && (
		!includes.length ||
		(isPageType(...includeStrings) || isAppType(...includeStrings) || matchesPageRegex(...includeRegExps))
	);
}

export const appType = once((): AppType => {
	if (document.documentElement.hasAttribute('res-options')) {
		return 'options';
	}
	if (document.documentElement.getAttribute('xmlns')) {
		return 'r2';
	}
	return 'd2x';
});

export function isAppType(...types: AppType[]): boolean {
	const thisApp = appType();
	return types.some(type => type === thisApp);
}

// What current Reddit says the page is, when it has said anything this knows.
// Absent on old Reddit and absent on current Reddit until the element has been
// parsed, which is why the caller must not settle on a fallback answer.
function declaredPageType(): ?PageType {
	const app = document.querySelector('shreddit-app');
	if (!app) return undefined;
	// `pagetype` names what the page is; `routename` names the route that
	// produced it. They agree on everything mapped, and `pagetype` is the one the
	// surveyed projects read, so it wins where a page carries both.
	return d2xPageTypeAttributes[app.getAttribute('pagetype') || ''] ||
		d2xRouteNames[app.getAttribute('routename') || ''];
}

export const pageType = memoizeUnsettled((): ?PageType => {
	const app = appType();
	const declared = app === 'd2x' ? declaredPageType() : undefined;
	if (declared) return declared;

	const spec = appPageTypes[app];
	return spec.pageTypes.find(pageType => regexes[pageType].test(location.pathname)) || spec.default;
}, () => appType() !== 'd2x' || !!document.querySelector('shreddit-app'));

export function matchesPageRegex(...regexps: RegExp[]): boolean {
	return regexps.some(regex => regex.test(location.pathname));
}

export const currentSubreddit = memoize((): string | void => {
	const match = location.pathname.match(regexes.subreddit);
	if (match) return match[1];
});

export function isCurrentSubreddit(...subreddits: string[]): boolean {
	const sub = (currentSubreddit() || '').toLowerCase();
	if (!sub) return false;
	return subreddits.some(v => v.toLowerCase() === sub);
}

export const currentMultireddit = memoize((): string | void => {
	const match = location.pathname.match(regexes.multireddit);
	if (match) return match[1];
});

export function isCurrentMultireddit(...multireddits: string[]): boolean {
	const multi = (currentMultireddit() || '').toLowerCase();
	if (!multi) return false;
	return multireddits.some(v => v.toLowerCase() === multi);
}

export const currentDomain = memoize((): string | void => {
	const match = location.pathname.match(regexes.domain);
	if (match) return match[1];
});

export const currentUserProfile = memoize((): string | void => {
	const match = location.pathname.match(regexes.profile);
	if (match) return match[1];
});

export function isPageType(...types: PageType[]): boolean {
	const thisPage = pageType();
	return types.some(type => type === thisPage);
}

export const inQuarantinedSubreddit = memoize(() => document.body.classList.contains('quarantine'));

function watchLocationChanges(): void {
	waitForEvent(document, 'reddit.urlChanged').then(() => {
		pageType.cache.clear();
		currentSubreddit.cache.clear();
		currentMultireddit.cache.clear();
		currentDomain.cache.clear();
		currentUserProfile.cache.clear();
		inQuarantinedSubreddit.cache.clear();
		watchLocationChanges();
	});
}

watchLocationChanges();
