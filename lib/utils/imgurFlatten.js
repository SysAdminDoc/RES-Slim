/* @flow */
// Pure helpers for the imgurFlatten module. Recognises imgur album / gallery
// URLs, rewrites them through a rimgo-style mirror, and parses the simple "ids"
// embedded in album HTML so showImages can stitch them inline. Dependency-free
// for unit testing.
//
// The mirror is a *list*, not a single value. A single hardcoded default has now
// died twice — rimgo.totaldarkness.net went to 502, then ri.bcow.xyz went to 403
// — and each time the module shipped visibly broken until a human noticed months
// later. A list plus a health check turns an instance going down into a
// one-request delay instead of a dead feature.
//
// The shipped defaults were probed on 2026-08-07 and only hosts that actually
// answered are included. Note `rimgo.privacyredirect.com`, which is on several
// published instance lists, did not resolve at all — do not re-add a host to
// this list without probing it, or the fix repeats the bug.

const ALBUM_RE = /^https?:\/\/(?:www\.|m\.)?imgur\.com\/(?:a|gallery)\/([a-zA-Z0-9]+)(?:[?#].*)?$/i;

// Ordered by preference. First entry is the one verified returning 200.
export const DEFAULT_MIRRORS: string[] = [
	'https://imgur.artemislena.eu',
	'https://rimgo.ducks.party',
	'https://rimgo.pussthecat.org',
];

export const DEFAULT_MIRROR: string = DEFAULT_MIRRORS[0];

// What the settings field ships with, and what an empty field falls back to.
export const DEFAULT_MIRROR_LIST: string = DEFAULT_MIRRORS.join('\n');

export function isImgurAlbumUrl(url: mixed): boolean {
	return typeof url === 'string' && ALBUM_RE.test(url);
}

export function extractAlbumId(url: mixed): string {
	if (typeof url !== 'string') return '';
	const m = ALBUM_RE.exec(url);
	return m ? m[1] : '';
}

export function sanitizeMirror(raw: mixed): string {
	if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_MIRROR;
	let value = raw.trim();
	if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
	return value.replace(/\/+$/, '');
}

// Comma- or newline-separated, deduplicated, order preserved. An empty or
// unusable field falls back to the shipped list rather than to nothing — an
// empty mirror list would silently disable the module.
export function parseMirrorList(raw: mixed): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_MIRRORS.slice();
	const out = [];
	const seen = new Set();
	for (const piece of raw.split(/[,\n]+/)) {
		if (!piece.trim()) continue;
		const norm = sanitizeMirror(piece);
		if (seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out.length ? out : DEFAULT_MIRRORS.slice();
}

export function rewriteAlbumUrl(url: string, mirror: string = DEFAULT_MIRROR): string {
	const id = extractAlbumId(url);
	if (!id) return url;
	const base = sanitizeMirror(mirror);
	return `${base}/a/${id}`;
}

export function rewriteImageUrl(url: string, mirror: string): string {
	if (typeof url !== 'string') return url;
	const base = sanitizeMirror(mirror);
	return url.replace(/^https?:\/\/i\.imgur\.com\//i, `${base}/`);
}

// A mirror is usable when it answers at all. 2xx and 3xx are healthy; so is 429,
// because a rate-limited instance is up and the next request may well succeed —
// treating it as dead would rotate away from a working host on one busy moment.
// 403/404/5xx and a transport failure are not.
export function isHealthyStatus(status: mixed): boolean {
	if (typeof status !== 'number' || !Number.isFinite(status)) return false;
	if (status === 429) return true;
	return status >= 200 && status < 400;
}

export function probeUrlFor(mirror: string): string {
	return `${sanitizeMirror(mirror)}/`;
}

// Walks the list in order and resolves the first mirror whose probe is healthy,
// or null when every one fails. `probe` returns a status number (or throws /
// resolves non-finite on a transport error), and is injected so the contract can
// exercise the fallthrough without a network.
export async function pickHealthyMirror(
	mirrors: string[],
	probe: (mirror: string) => Promise<mixed>,
): Promise<?string> {
	for (const mirror of mirrors) {
		let status;
		try {
			// eslint-disable-next-line no-await-in-loop
			status = await probe(mirror);
		} catch (e) {
			continue;
		}
		if (isHealthyStatus(status)) return mirror;
	}
	return null;
}
