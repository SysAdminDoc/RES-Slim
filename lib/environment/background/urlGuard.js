/* @flow */
// Defense-in-depth for the background fetch/download proxies. The proxies are
// only reachable from this extension's own content script (no externally_-
// connectable), but a content-script XSS could otherwise use them as a confused
// deputy. The browser already enforces the *host* boundary (a background fetch
// to a non-granted origin fails), so the meaningful app-level check is scheme:
// reject anything that isn't absolute http(s) (file:, data:, blob:, javascript:,
// chrome-extension:, …). Pure and dependency-free for unit testing.

// A URL a tab may be opened at.
//
// The scheme check above is for the *fetch* proxies, where anything but http(s)
// is a confused-deputy request. A tab is different: the settings console's own
// recovery path opens `chrome-extension://<this extension>/options.html` when the
// embedded frame fails to load, which the scheme check refused -- so a reader
// whose console was blocked got an empty page and no way back. This extension's
// own pages are the one addition, and only this extension's: another extension's
// id would not be ours to open.
export function isOpenableTabUrl(url: mixed): boolean {
	if (isProxyableUrl(url)) return true;
	if (typeof url !== 'string') return false;
	// Compared as a prefix rather than through `URL.origin`. An extension scheme
	// is not a special scheme, so `origin` is the opaque string "null" for every
	// one of them -- and for `file:` too, which made an origin comparison say
	// `file:///etc/passwd` was this extension.
	//
	// `getURL('')` is `<scheme>://<this id>/`, and the trailing slash is what
	// stops a host that merely starts with our id from matching.
	try {
		const base = chrome.runtime.getURL('');
		return !!base && url.startsWith(base);
	} catch (err) {
		return false;
	}
}

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
