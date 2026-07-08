/* @flow */
// Pure helpers for the repostDedupe module. Reduces a post's link/thumbnail to a
// stable key so the module can collapse a second appearance of the same media in
// a listing (crossposts, karma-farm reposts of an identical image URL). Pure URL
// normalisation — no network, no canvas. Dependency-free for unit testing.

// Pull a stable media id out of the common Reddit/imgur image hosts so that
// preview.redd.it CDN variants and i.redd.it/i.imgur permutations of the same
// upload collapse to one key.
function mediaId(host: string, pathname: string): ?string {
	const file = pathname.replace(/^\/+/, '').split('/').pop() || '';
	const base = file.replace(/\.[a-z0-9]+$/i, '');
	if (!base) return null;
	if (host === 'i.redd.it' || host === 'preview.redd.it') return `redd:${base}`;
	if (host.endsWith('imgur.com')) return `imgur:${base}`;
	return null;
}

// Normalise a post URL into a dedupe key. Returns null when the URL is unusable
// (self posts, empty), so the caller skips them rather than collapsing all of a
// kind together.
export function normalizePostKey(rawUrl: mixed): ?string {
	if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
	let url;
	try {
		url = new URL(rawUrl, 'https://old.reddit.com');
	} catch (err) {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	// Self / comment permalinks are not reposts of external media — skip.
	if (host.endsWith('reddit.com') && /\/comments\//.test(url.pathname)) return null;

	const id = mediaId(host, url.pathname);
	if (id) return id;

	const path = url.pathname.replace(/\/+$/, '') || '/';
	return `url:${host}${path}`;
}

// Also key off the visible thumbnail so image reposts whose external links differ
// but resolve to the same Reddit-hosted preview still collapse.
export function thumbnailKey(rawSrc: mixed): ?string {
	if (typeof rawSrc !== 'string' || !rawSrc.trim()) return null;
	if (/^(self|default|nsfw|spoiler|image)$/i.test(rawSrc.trim())) return null;
	return normalizePostKey(rawSrc);
}

// A small stateful tracker the module instantiates per listing.
export function createSeenTracker(): {| seen: (key: string) => boolean, size: () => number |} {
	const set: Set<string> = new Set();
	return {
		seen(key) {
			if (set.has(key)) return true;
			set.add(key);
			return false;
		},
		size() { return set.size; },
	};
}
