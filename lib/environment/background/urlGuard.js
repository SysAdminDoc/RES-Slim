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
