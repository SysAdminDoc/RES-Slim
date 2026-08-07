/* @flow */

// Who is allowed to talk to the settings console over postMessage, and what they
// are allowed to say.
//
// `options.html` is web-accessible and is embedded as an iframe inside reddit
// pages, so *any* cross-origin frame on that page — a media embed, an ad frame —
// can post to it. The console's own message handler already checked the sender;
// the bootstrap in `lib/environment/foreground/context.js` did not, and it
// adopted `origin` and `userHash` from the first message that arrived from
// anyone. Those two values then feed the base URL of every options-page request
// (sent with `credentials: 'include'` and an `X-Modhash` header) and the rewrite
// of every link in the console.
//
// Both callers now share these predicates. They are pure so the contract can
// execute them against hostile input rather than assert their source text.

export function isRedditOrigin(origin: mixed): boolean {
	if (typeof origin !== 'string' || !origin) return false;
	let parsed;
	try {
		parsed = new URL(origin);
	} catch (e) {
		return false;
	}
	// An `origin` is scheme + host + port and nothing else; anything carrying a
	// path or a query is not one, and accepting it would let
	// `https://evil.example/?x=https://reddit.com` through a sloppier check.
	if (parsed.origin !== origin) return false;
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
	const { hostname } = parsed;
	// Suffix matching on the dot, so `notreddit.com` and
	// `reddit.com.attacker.test` are both rejected.
	return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
}

export function isTrustedConsoleOrigin(origin: mixed, optionsOrigin: ?string): boolean {
	// The extension's own standalone options page posts to itself.
	if (typeof optionsOrigin === 'string' && optionsOrigin && origin === optionsOrigin) return true;
	// Otherwise the only legitimate sender is the reddit content script in the
	// embedding frame.
	return isRedditOrigin(origin);
}

// A trusted sender can still post a malformed payload — settingsNavigation posts
// several different message shapes to the same window — so the bootstrap has to
// recognise its own message rather than assume any message is one.
//
// Returns the subset that is safe to apply, or null when the payload is not a
// context message at all. Never throws: a throw here used to leave the console
// permanently in `failedToLoad`.
export function sanitizeContext(payload: mixed): {| userHash?: ?string, username?: ?string, origin?: string, pathname?: string |} | null {
	if (!payload || typeof payload !== 'object') return null;
	const context = (payload: any).context;
	if (!context || typeof context !== 'object') return null;

	const out = {};

	// `origin` is the base every options-page request is resolved against, so it
	// is the one field that must be re-validated even coming from a trusted
	// sender. A value we do not recognise is dropped, leaving the built-in
	// default, rather than failing the whole load.
	if (isRedditOrigin(context.origin)) out.origin = context.origin;

	if (typeof context.pathname === 'string' && context.pathname.startsWith('/')) out.pathname = context.pathname;
	if (typeof context.username === 'string' || context.username === null) out.username = context.username;
	if (typeof context.userHash === 'string' || context.userHash === null) out.userHash = context.userHash;

	return Object.keys(out).length ? out : null;
}
