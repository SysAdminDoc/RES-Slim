/* @flow */

// A local record of which posts you have opened.
//
// old.reddit relies on the browser's `:visited` styling for this, which Chrome
// deliberately neuters (it refuses to expose the state to script and restricts
// which properties `:visited` may set) — so on a dark theme the visited colour
// is frequently indistinguishable from the unvisited one. The "Reddit visited
// link remover" userscript solves it by asking for the `history` permission.
//
// This does not. The store is a plain map of post fullname to last-opened
// timestamp, written when you click through and read when a listing renders. It
// is also the local visited-set the roadmap needs in order to drop the `history`
// permission from both manifests.

export type VisitedMap = { [fullname: string]: number };

export const DEFAULT_EXPIRE_DAYS = 90;

// Fullnames are the only stable identity: a post's permalink changes when the
// title is edited and differs between /r/<sub>/ and /r/all listings.
const FULLNAME = /^t3_[a-z0-9]+$/i;

export function isPostFullname(value: ?string): boolean {
	return typeof value === 'string' && FULLNAME.test(value);
}

// Accepts either a fullname or a comments URL, because a click on the title link
// gives us the URL while the listing row gives us the fullname.
export function fullnameFromCommentsUrl(url: ?string): ?string {
	if (typeof url !== 'string' || !url) return null;
	let pathname;
	try {
		({ pathname } = new URL(url, 'https://old.reddit.com'));
	} catch (e) {
		return null;
	}
	const match = pathname.match(/\/comments\/([a-z0-9]+)/i);
	return match ? `t3_${match[1]}` : null;
}

export function markVisited(map: VisitedMap, fullname: string, nowMs: number): VisitedMap {
	if (!isPostFullname(fullname)) return map;
	return { ...map, [fullname]: nowMs };
}

export function isVisited(map: VisitedMap, fullname: ?string): boolean {
	if (!isPostFullname(fullname)) return false;
	return Object.hasOwn(map, (fullname: any));
}

// Unbounded growth is what makes these stores turn into a performance problem
// six months in: a heavy browser visits tens of thousands of posts.
export function pruneVisited(map: VisitedMap, expireDays: number, nowMs: number): {| map: VisitedMap, removed: number |} {
	const days = Number.isFinite(expireDays) && expireDays > 0 ? expireDays : DEFAULT_EXPIRE_DAYS;
	const cutoff = nowMs - days * 86400000;
	const out = {};
	let removed = 0;
	for (const key of Object.keys(map)) {
		const at = map[key];
		if (typeof at === 'number' && at >= cutoff) out[key] = at;
		else removed++;
	}
	return { map: out, removed };
}

// Which post, if any, an activation on this element means the reader is opening.
//
// Pulled out of the module so it can be executed against real elements rather
// than asserted about from source: it is the whole decision, and the module now
// reaches it from two events rather than one.
export function fullnameFromActivation(target: ?Element): ?string {
	if (!target) return null;
	const anchor = target.closest('a[href]');
	if (!anchor) return null;

	const fromUrl = fullnameFromCommentsUrl(anchor.getAttribute('href'));
	if (fromUrl) return fromUrl;

	// Not a comments link — but if the activation landed inside a post row and the
	// row's own title link was followed, that still counts as opening the post.
	if (!anchor.classList.contains('title')) return null;
	const row = target.closest('.thing');
	return row ? row.getAttribute('data-fullname') : null;
}
