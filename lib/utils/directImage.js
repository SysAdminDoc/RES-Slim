/* @flow */
// Pure helpers for the directImage module. Decides whether a post links to a
// direct image/video URL based on its data-domain and data-url. Dependency-free
// so it can be unit-tested without DOM.

const DEFAULT_DIRECT_HOSTS: $ReadOnlyArray<string> = Object.freeze([
	'i.redd.it',
	'i.imgur.com',
	'v.redd.it',
	'preview.redd.it',
]);

export function parseDomainList(raw: mixed): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_DIRECT_HOSTS.slice();
	const out: string[] = [];
	const seen: Set<string> = new Set();
	for (const piece of raw.split(/[,\s\n]+/)) {
		const norm = piece.trim().toLowerCase();
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out.length ? out : DEFAULT_DIRECT_HOSTS.slice();
}

const IMAGE_EXT_RE = /\.(?:jpg|jpeg|png|gif|webp|bmp|svg|avif)(?:$|[?#])/i;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i;
const GIFV_RE = /imgur\.com\/(?!a\/|gallery\/)[a-z0-9]+\.gifv?$/i;

export function isDirectMediaUrl(url: mixed, includeVideo: boolean = true): boolean {
	if (typeof url !== 'string' || !url) return false;
	if (IMAGE_EXT_RE.test(url)) return true;
	if (includeVideo && VIDEO_EXT_RE.test(url)) return true;
	if (GIFV_RE.test(url)) return true;
	return false;
}

export function shouldRewrite(
	domain: mixed,
	url: mixed,
	allowedHosts: $ReadOnlyArray<string>,
	includeVideo: boolean = true,
): boolean {
	const d = typeof domain === 'string' ? domain.toLowerCase() : '';
	if (!d || !url) return false;
	if (allowedHosts.indexOf(d) >= 0 && isDirectMediaUrl(url, includeVideo)) return true;
	return false;
}

export function normalizeImgurGifv(url: string): string {
	// imgur .gifv links resolve to an HTML page, but the .mp4 sibling is a
	// direct video. Rewrite .gifv -> .mp4 so the user lands on raw media.
	if (typeof url !== 'string') return url;
	return url.replace(/(imgur\.com\/[^/?#]+)\.gifv(\b|$)/i, '$1.mp4$2');
}
