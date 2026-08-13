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
