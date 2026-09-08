/* @flow */

import { partition, once, memoize, memoizeUnsettled } from './functional';
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
	// Canonical, because this value is parsed rather than only compared. Reddit
	// serves the same multireddit under `/u/bob/m/x` and `/user/bob/m/x`, and
	// `filteReddit`'s CurrentMulti case splits the result on an optional `user/`
	// prefix -- handed the short form it would read the owner as `u` and quietly
	// evaluate false.
	if (match) return match[1].replace(/^u\//i, 'user/');
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

// Every memo whose answer is a property of the route, cleared together.
//
// Exported because when they are cleared is not this module's decision alone.
// Core's `reddit.urlChanged` listener runs the `beforeLoad` pass synchronously
// on entry, so it has to be able to clear these before the first module reads
// one, and it should not have to know which six they are.
export function clearLocationCaches(): void {
	pageType.cache.clear();
	currentSubreddit.cache.clear();
	currentMultireddit.cache.clear();
	currentDomain.cache.clear();
	currentUserProfile.cache.clear();
	inQuarantinedSubreddit.cache.clear();
}

// A plain listener, not a one-shot promise re-armed from its own handler.
//
// `waitForEvent` resolves a promise, and a `.then` runs a microtask after every
// synchronous listener of the same event. Core's is one of those, and it runs
// the `beforeLoad` pass on entry -- so the modules whose eligibility had just
// changed were asked about the route that had already been left, while the three
// later stages, past an `await`, saw the new one. Five values disagreed with
// each other inside one route change: the subreddit, the multireddit, the
// domain, the profile and the quarantine flag.
//
// The re-arm was the second half of it. It happened in that same microtask, so a
// second `reddit.urlChanged` dispatched from inside a listener of the first was
// not seen at all, and the caches stayed on a route nobody was on any more.
document.addEventListener('reddit.urlChanged', clearLocationCaches);
