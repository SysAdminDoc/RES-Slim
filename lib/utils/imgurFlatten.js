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

// Ordered by preference. Both entries verified on 2026-08-18 as *serving rimgo*,
// not merely returning 200.
//
// That distinction is the whole point now. A status code alone cannot tell a
// working instance from an anti-bot interstitial, and on 2026-08-18 the two
// previously shipped defaults failed in two different ways that a status check
// could not separate: rimgo.ducks.party was gone outright (connection timeout),
// while imgur.artemislena.eu answered 200 with a "Making sure you're not a bot!"
// challenge page. The second one had been the first-choice default, so the module
// was resolving "healthy" to a host that never returns album HTML — the third
// dead default in a row, and the first that a 200 actively concealed.
// rimgo.bloat.cat and r.opnxng.com were rejected for the same reason (Cloudflare
// and bot challenges respectively), as rimgo.pussthecat.org was before them for
// answering 418. Shipping an unverified host is the exact mistake the previous
// dead defaults were.
//
// Verification for both entries below: root document titled `rimgo`, and a
// nonexistent album id handled as a normal rimgo route rather than a challenge.
export const DEFAULT_MIRRORS: string[] = [
	'https://rimgo.reallyaweso.me',
	'https://rmgur.com',
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

// The host-permission match pattern a mirror needs before the extension can read
// its response at all. rimgo instances send no `Access-Control-Allow-Origin`, so
// unlike the Arctic Shift / pullpush / Wayback endpoints — which work purely on
// their own CORS `*` — a mirror fetch from the service worker is blocked outright
// without this. Empty string for anything that will not parse as a URL.
export function originForMirror(mirror: mixed): string {
	if (typeof mirror !== 'string' || !mirror.trim()) return '';
	try {
		return `${new URL(sanitizeMirror(mirror)).origin}/*`;
	} catch (e) {
		return '';
	}
}

// What a real rimgo instance's root document contains. Either the page title or
// the source link back to the project is enough; requiring both would break on
// the instances that rebrand the title (rmgur.com does not, but a fork may).
export const MIRROR_MARKER: RegExp = /<title>[^<]*\brimgo\b[^<]*<\/title>|codeberg\.org\/rimgo\/rimgo/i;

export function looksLikeMirror(body: mixed): boolean {
	return typeof body === 'string' && MIRROR_MARKER.test(body);
}

// Status alone cannot tell a working instance from an anti-bot interstitial:
// imgur.artemislena.eu shipped as the first-choice default for months while
// answering 200 with "Making sure you're not a bot!". So a 200 has to prove
// itself by containing rimgo's own markup.
//
// A bare number is still accepted as a status-only probe — that is the shape the
// contract injects to exercise the fallthrough without a network, and it keeps
// this honest about what it can and cannot judge.
export function isHealthyProbe(result: mixed): boolean {
	if (result === null || typeof result !== 'object') return isHealthyStatus(result);

	const record: { +status?: mixed, +body?: mixed } = (result: any);
	if (!isHealthyStatus(record.status)) return false;
	// A rate-limited instance is alive but is serving an error page, not album
	// HTML, so there is no body to judge and status is the only signal there is.
	if (record.status === 429) return true;
	return looksLikeMirror(record.body);
}

// Walks the list in order and resolves the first mirror whose probe is healthy,
// or null when every one fails. `probe` resolves to `{ status, body }` (or a bare
// status number, or throws on a transport error), and is injected so the contract
// can exercise the fallthrough without a network.
export async function pickHealthyMirror(
	mirrors: string[],
	probe: (mirror: string) => Promise<mixed>,
): Promise<?string> {
	for (const mirror of mirrors) {
		let result;
		try {
			// eslint-disable-next-line no-await-in-loop
			result = await probe(mirror);
		} catch (e) {
			continue;
		}
		if (isHealthyProbe(result)) return mirror;
	}
	return null;
}
