/* @flow */
// Pure helpers for the local visited-link set that replaced the `history`
// permission.
//
// `showImages` used to call `chrome.history.addUrl()` when you expanded a media
// link, purely so the link would repaint with the browser's `:visited` colour.
// One cosmetic behaviour was the sole reason both manifests asked for
// "Read and change your browsing history" — by a wide margin the scariest line
// in the Chrome install prompt, and the one most likely to make someone cancel.
//
// This set is local, keyed by URL, capped and pruned. Nothing leaves the
// machine, and no permission is required to keep it: `chrome.storage.local`
// needs none.

export type VisitedLinkMap = { [url: string]: number };

export const DEFAULT_EXPIRE_DAYS = 90;

// A visited set that grows forever turns into a performance problem six months
// in, and unlike posts, media URLs are effectively unbounded — a single busy
// listing can add fifty. The cap is enforced on write, not just on prune, so a
// user who never triggers a prune still cannot grow an unbounded blob.
export const MAX_ENTRIES = 5000;

// Params that never identify the resource: tracking, CDN signatures, and size
// hints that rotate between renders of the same image. Stripping these is what
// makes the same picture match itself across a listing and a thread.
//
// A denylist, not an allowlist. The first version dropped the query wholesale,
// which collapsed every `youtube.com/watch?v=<id>` into a single key — so
// expanding one video marked every YouTube link on the site as visited. Anything
// not named here is assumed to identify the resource, because the cost of
// keeping a junk param is one duplicate entry, while the cost of dropping a
// meaningful one is marking unrelated media as seen.
const VOLATILE_PARAMS = new Set([
	'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'msclkid', 'ref', 'ref_source',
	'ref_campaign', 's', 'share_id', 'si', 'source', 'utm_campaign', 'utm_content',
	'utm_medium', 'utm_name', 'utm_source', 'utm_term',
	// Preview/CDN sizing: preview.redd.it serves the same image at many widths.
	'auto', 'blur', 'crop', 'format', 'fit', 'h', 'height', 'quality', 'w', 'width',
]);

// Normalising matters more here than for posts: the same image is reached
// through `?utm_source=`, a trailing `#`, and both `http` and `https`. Without
// this the set silently misses, and the feature looks broken rather than absent.
//
// The fragment is always dropped — it addresses a position within a resource, not
// a resource. Query params survive unless they are known-volatile, sorted so that
// param order cannot split one resource into two entries.
export function normalizeUrl(url: mixed): ?string {
	if (typeof url !== 'string' || !url.trim()) return null;

	let parsed;
	try {
		parsed = new URL(url, 'https://old.reddit.com');
	} catch (e) {
		return null;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

	const host = parsed.host.toLowerCase().replace(/^www\./, '');
	const path = parsed.pathname.replace(/\/+$/, '');

	const kept = [];
	for (const [key, value] of parsed.searchParams) {
		if (VOLATILE_PARAMS.has(key.toLowerCase())) continue;
		kept.push([key, value]);
	}
	kept.sort(([a, aV], [b, bV]) => (a < b ? -1 : a > b ? 1 : (aV < bV ? -1 : aV > bV ? 1 : 0)));

	const query = kept.map(([key, value]) => `${key}=${value}`).join('&');
	return query ? `${host}${path}?${query}` : `${host}${path}`;
}

export function markVisited(map: VisitedLinkMap, url: mixed, nowMs: number): VisitedLinkMap {
	const key = normalizeUrl(url);
	if (!key) return map;
	return { ...map, [key]: nowMs };
}

export function isVisited(map: VisitedLinkMap, url: mixed): boolean {
	const key = normalizeUrl(url);
	if (!key) return false;
	return Object.hasOwn(map, key);
}

// The storage layer writes by shallow patch and deletes by key list, so these
// return the keys to remove rather than a rebuilt map. Returning a whole map
// would force a read-modify-write, which races another tab expanding an image at
// the same moment — patch-and-delete does not.

// Entries older than the window, plus any whose timestamp is corrupt. A
// non-numeric or future timestamp is not "fresh"; leaving it in would make that
// entry immortal.
export function expiredKeys(map: VisitedLinkMap, expireDays: number, nowMs: number): string[] {
	const days = Number.isFinite(expireDays) && expireDays > 0 ? expireDays : DEFAULT_EXPIRE_DAYS;
	const cutoff = nowMs - days * 86400000;

	return Object.keys(map).filter(key => {
		const at = map[key];
		return !(typeof at === 'number' && Number.isFinite(at) && at > cutoff && at <= nowMs);
	});
}

// The oldest keys beyond the cap. Ties break by key name so eviction is
// deterministic — an order that depended on object insertion order would be
// untestable, and would differ between a fresh read and a patched cache.
export function overflowKeys(map: VisitedLinkMap, max: number = MAX_ENTRIES): string[] {
	const keys = Object.keys(map);
	if (keys.length <= max) return [];

	keys.sort((a, b) => (map[b] - map[a]) || (a < b ? -1 : a > b ? 1 : 0));
	return keys.slice(max);
}

export function pruneVisited(map: VisitedLinkMap, expireDays: number, nowMs: number): {| map: VisitedLinkMap, removed: string[] |} {
	const removed = new Set([
		...expiredKeys(map, expireDays, nowMs),
		...overflowKeys(map),
	]);

	const out = {};
	for (const key of Object.keys(map)) {
		if (!removed.has(key)) out[key] = map[key];
	}

	return { map: out, removed: [...removed] };
}
