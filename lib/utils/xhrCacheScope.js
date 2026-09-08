/* @flow */
// Which cached response belongs to whom.
//
// The `ajax({ cacheFor })` cache is one map shared by every tab, and several of
// the things it holds are fetched with `credentials: 'include'` — the signed-in
// user's own name and modhash among them. Keyed on the bare URL, a private
// window's response was served to a normal window and back again.
//
// Pure and dependency-free so it can be executed by a test, in the same split
// `penaltyBox` uses: the policy lives here, the `chrome.runtime` wiring stays in
// `lib/environment/background/xhrCache.js`.

import { LRUCache } from './Cache';

// Firefox has more than just (non)incognito, so it must be limited per
// cookieStoreId. Same choice, and the same reason, as `background/multicast.js`.
const CONTEXT_KEY = process.env.BUILD_TARGET === 'firefox' ? 'cookieStoreId' : 'incognito';

// A message with no tab comes from the extension's own pages — the options page
// and the background itself — which read the normal profile's cookies. They
// share one partition, distinct from any tab's.
export function cacheContext(sender: ?{ tab?: ?{ [string]: mixed } }): string {
	const tab = sender && sender.tab;
	if (!tab) return 'extension';
	return `tab:${String(tab[CONTEXT_KEY])}`;
}

// The rest of the key — method and credentials — is composed by the caller in
// `foreground/ajax.js`: this side knows which tab asked, that side knows what it
// asked for.
export function applyCacheOperation(
	cache: LRUCache<string, any>,
	message: any,
	sender: ?{ tab?: ?{ [string]: mixed } },
): mixed {
	const [operation, key, value] = message;
	const scoped = `${cacheContext(sender)}|${String(key)}`;

	switch (operation) {
		case 'set':
			cache.set(scoped, value);
			return undefined;
		case 'check':
			return cache.get(scoped, value);
		case 'delete':
			return cache.delete(scoped);
		case 'clear':
			// Deliberately every context: the only caller is a reader emptying the
			// cache outright, and leaving another window's copies behind would make
			// that button a lie.
			return cache.clear();
		default:
			throw new Error(`Invalid XHRCache operation: ${String(operation)}`);
	}
}
