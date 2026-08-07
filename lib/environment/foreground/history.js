/* @flow */
// A local visited-link set, replacing the `history` permission.
//
// These two functions used to be thin wrappers over `chrome.history.addUrl()`
// and `chrome.history.getVisits()`, which is why both manifests declared
// `history` — "Read and change your browsing history", the scariest line in the
// Chrome install prompt. The only live caller is `showImages`, marking an
// expanded media link as visited so it repaints in the visited colour.
//
// Reading and writing the user's real browsing history is a wildly
// disproportionate way to remember which thumbnails they opened. The set now
// lives in `chrome.storage.local`, which needs no permission, holds only
// normalised host+path strings, and is capped and pruned.
//
// The signatures are unchanged, so no caller had to move. The one visible
// difference is that these entries no longer participate in the browser's native
// `:visited` styling — Chrome deliberately hides `:visited` from script, so
// `showImages` marks the anchor with a class instead.

import {
	DEFAULT_EXPIRE_DAYS,
	expiredKeys,
	isVisited,
	normalizeUrl,
	overflowKeys,
} from '../../utils/visitedLinks';
import { wrapBlob } from './storage';
import { isPrivateBrowsing } from './privateBrowsing';

const store = wrapBlob('RES.visitedLinks', (): number => 0);

// One read per page, shared by every caller. Without it, expanding ten images on
// a listing is ten storage round-trips.
let cache: ?Promise<{ [string]: number }>;

function load(): Promise<{ [string]: number }> {
	if (!cache) cache = store.getAll().then(map => map || {});
	return cache;
}

export async function addURLToHistory(url: string): Promise<void> {
	// Private browsing wrote nothing to the real history and must write nothing
	// here either — a local record is still a record.
	if (isPrivateBrowsing()) return;

	const key = normalizeUrl(url);
	if (!key) return;

	const now = Date.now();
	const current = await load();

	// A shallow `set` rather than writing back a rebuilt map: two tabs expanding
	// images at the same moment would otherwise clobber each other's entries.
	cache = Promise.resolve({ ...current, [key]: now });
	await store.set(key, now);

	// Pruned opportunistically on write. A timer is useless here — an MV3 service
	// worker is torn down between page loads and never gets to run one — and the
	// cost is one pass over a map that is capped anyway.
	const next = await load();
	const stale = [...new Set([...expiredKeys(next, DEFAULT_EXPIRE_DAYS, now), ...overflowKeys(next)])];
	if (!stale.length) return;

	const pruned = { ...next };
	for (const staleKey of stale) delete pruned[staleKey];
	cache = Promise.resolve(pruned);
	await store.deleteMultiple(stale);
}

export async function isURLVisited(url: string): Promise<boolean> {
	return isVisited(await load(), url);
}
