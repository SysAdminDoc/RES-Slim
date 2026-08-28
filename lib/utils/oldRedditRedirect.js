/* @flow */
// Shared URL policy for the opt-in www.reddit.com -> old.reddit.com redirect.
// The foreground fallback and background DNR rule must agree on exclusions;
// keeping the policy here prevents an allowed login/account route from being
// redirected later by the content script.

export const REDIRECT_ESCAPE_PARAM = 'res_slim_redirect';
export const REDIRECT_ESCAPE_VALUE = 'off';

export const OLD_REDDIT_DYNAMIC_RULE_IDS: $ReadOnlyArray<number> = Object.freeze([
	900001,
	900002,
	900003,
]);

// The host toggle used to escape the redirect with nothing but a query parameter
// on the URL it navigated to. That escapes exactly one request. Current Reddit is
// a single-page app, so the first in-page navigation drops the parameter, and the
// next real request - a reload, a link opened from elsewhere, or reddit's own bot
// challenge rewriting the query - matched the redirect rule again and threw the
// tab back to old Reddit, which now wants a login. Clicking `www` did not switch
// renderers so much as postpone the redirect by one page.
//
// The escape is therefore a property of the tab, not of a URL: one session rule
// whose `tabIds` lists every tab that asked to stay on current Reddit. Session
// rules outlive the service worker and die with the browser, which is the
// lifetime this should have. The rule itself is the store - reading it back is
// what lets a restarted worker add a tab without forgetting the others.
export const HOST_ESCAPE_RULE_ID = 900004;

// Written by the content script on www.reddit.com, read by it on the next
// document in the same tab. `sessionStorage` is per tab and per origin, which is
// exactly the scope wanted, and it is synchronous - the foreground redirect
// fallback runs at document_start and cannot wait for a message round trip.
export const HOST_ESCAPE_SESSION_KEY = 'rsm-host-escape';

const PROTECTED_PATH_PREFIXES: $ReadOnlyArray<string> = Object.freeze([
	'/account',
	'/login',
	'/ads',
	'/register',
	'/password',
	'/verification',
	'/oauth2',
	'/api/v1/authorize',
]);

// DNR uses RE2 syntax. These expressions intentionally avoid lookaround so the
// same rules are accepted by the supported Chrome and Firefox versions.
export const PROTECTED_REDIRECT_REGEX = '^https://www\\.reddit\\.com/(?:account|login|ads|register|password|verification|oauth2|api/v1/authorize)(?:[/?]|$)';
export const ESCAPE_REDIRECT_REGEX = '^https://www\\.reddit\\.com/.*[?&]res_slim_redirect=off(?:&|$)';

function asUrl(input: string | URL): URL | null {
	try {
		return input instanceof URL ? new URL(input.toString()) : new URL(input);
	} catch (e) {
		return null;
	}
}

// Priority 3, above the redirect rule at 1 and the two allows at 2, so a tab that
// asked to stay wins over every other rule here.
export function buildHostEscapeRule(tabIds: $ReadOnlyArray<number>): { [string]: any } {
	return {
		id: HOST_ESCAPE_RULE_ID,
		priority: 3,
		action: { type: 'allow' },
		condition: {
			urlFilter: '|https://www.reddit.com/',
			resourceTypes: ['main_frame'],
			tabIds: [...tabIds],
		},
	};
}

export function hasRedirectEscapeParam(input: string | URL): boolean {
	const url = asUrl(input);
	return !!url && url.searchParams.get(REDIRECT_ESCAPE_PARAM) === REDIRECT_ESCAPE_VALUE;
}

export function isProtectedRedditPath(pathname: string): boolean {
	return PROTECTED_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function shouldRedirectToOld(input: string | URL): boolean {
	const url = asUrl(input);
	return !!(
		url &&
		url.protocol === 'https:' &&
		url.hostname === 'www.reddit.com' &&
		!isProtectedRedditPath(url.pathname) &&
		url.searchParams.get(REDIRECT_ESCAPE_PARAM) !== REDIRECT_ESCAPE_VALUE
	);
}

export function oldRedditUrl(input: string | URL): string | null {
	const url = asUrl(input);
	if (!url || !shouldRedirectToOld(url)) return null;
	url.hostname = 'old.reddit.com';
	return url.toString();
}

export function hostToggleUrl(input: string | URL, targetHost: string, bypassAutoRedirect: boolean = false): string | null {
	const url = asUrl(input);
	if (!url) return null;
	url.hostname = targetHost;
	if (targetHost === 'www.reddit.com' && bypassAutoRedirect) {
		url.searchParams.set(REDIRECT_ESCAPE_PARAM, REDIRECT_ESCAPE_VALUE);
	} else {
		url.searchParams.delete(REDIRECT_ESCAPE_PARAM);
	}
	return url.toString();
}

export function storedAutoRedirectEnabled(values: { [string]: any }): boolean {
	const options = values['RESoptions.oldRedditRedirect'];
	const modulePrefs = values['RES.modulePrefs'];
	return !!(
		options &&
		options.autoRedirect &&
		options.autoRedirect.value === true &&
		(!modulePrefs || modulePrefs.oldRedditRedirect !== false)
	);
}

export function buildOldRedditRedirectRules(): Array<{ [string]: any }> {
	return [
		{
			id: OLD_REDDIT_DYNAMIC_RULE_IDS[0],
			priority: 2,
			action: { type: 'allow' },
			condition: {
				regexFilter: PROTECTED_REDIRECT_REGEX,
				resourceTypes: ['main_frame'],
			},
		},
		{
			id: OLD_REDDIT_DYNAMIC_RULE_IDS[1],
			priority: 2,
			action: { type: 'allow' },
			condition: {
				regexFilter: ESCAPE_REDIRECT_REGEX,
				resourceTypes: ['main_frame'],
			},
		},
		{
			id: OLD_REDDIT_DYNAMIC_RULE_IDS[2],
			priority: 1,
			action: {
				type: 'redirect',
				redirect: {
					// Omitting path/query/fragment preserves all three while replacing
					// only the scheme and host before document bytes are requested.
					transform: { scheme: 'https', host: 'old.reddit.com' },
				},
			},
			condition: {
				urlFilter: '|https://www.reddit.com/',
				resourceTypes: ['main_frame'],
			},
		},
	];
}
