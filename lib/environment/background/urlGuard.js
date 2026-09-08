/* @flow */
// Defense-in-depth for the background fetch/download proxies. The proxies are
// only reachable from this extension's own content script (no externally_-
// connectable), but a content-script XSS could otherwise use them as a confused
// deputy. The browser already enforces the *host* boundary (a background fetch
// to a non-granted origin fails), so the meaningful app-level check is scheme:
// reject anything that isn't absolute http(s) (file:, data:, blob:, javascript:,
// chrome-extension:, …). Pure and dependency-free for unit testing.

export function isProxyableUrl(url: mixed): boolean {
	if (typeof url !== 'string' || !url.trim()) return false;
	let parsed;
	try {
		parsed = new URL(url);
	} catch (err) {
		return false;
	}
	return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

// The bundles the foreground is allowed to ask the background to inject.
//
// `chrome.scripting.executeScript`'s `files` only resolves inside the package,
// so this cannot reach the web -- but without it a content-script XSS can inject
// any of this extension's own bundles into the frame it is running in, which is
// not a thing any caller needs. There are three callers and they name three
// files.
const INJECTABLE_SCRIPTS = new Set([
	'/jszip.min.js',
	'/dash.mediaplayer.min.js',
	'/snudown.entry.js',
]);

export function isInjectableScript(url: mixed): boolean {
	return typeof url === 'string' && INJECTABLE_SCRIPTS.has(url);
}

export function injectableScripts(): string[] {
	return [...INJECTABLE_SCRIPTS];
}
