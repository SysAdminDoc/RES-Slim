/* @flow */

// The scheme allowlist for anything a site module hands back to showImages.
//
// `credits` and `caption` were the only fields `generateMedia` sanitized, and
// they are the only two that carry markup. Every other field is a URL that goes
// straight into an `href`, an `img src`, a `video src` or an `iframe src`.
// `string.html` escapes those for the attribute, which stops a breakout but says
// nothing about the scheme: a `javascript:` href is a click-to-run script, and a
// `javascript:` iframe src runs immediately in reddit.com's own origin.
//
// Most handlers rebuild the URL from an id their own `detect()` regex captured,
// so this is not reachable from a plain hostile post. Several do not - deviantart
// returns `info.fullsize_url`, flickr `info.url`, gyazo and imgur their `link`
// field - so a compromised or hostile media API is enough. One allowlist at the
// single boundary every host passes through is cheaper than trusting fourteen of
// them plus whatever they proxy.
//
// Lives here rather than inline in `mediaTypes.js` so it can be executed by a
// test: that file pulls in dashjs, DOMPurify and the whole media runtime, none of
// which loads outside a browser.

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

// `galleryZip` and the video unloader build `blob:` object URLs, and a few hosts
// inline a small image. A `data:` document is a different thing entirely - it
// carries its own script - so only images are allowed through that door.
const INLINE_IMAGE = /^data:image\//i;

// Exactly this string, not the `about:` scheme. `googlemaps` returns it as its
// deliberate "there is nothing to show" value for a share link that carries a
// place name instead of coordinates, which is the common shape - so rejecting it
// broke a live host rather than a hostile one. An empty document executes
// nothing; `about:srcdoc` and the rest are not on this list and have no business
// being returned by a media handler.
const BLANK_DOCUMENT = 'about:blank';

export function isSafeMediaUrl(value: mixed, base: string): boolean {
	if (typeof value !== 'string' || !value) return false;
	if (value === BLANK_DOCUMENT) return true;
	if (INLINE_IMAGE.test(value)) return true;
	let parsed;
	try {
		parsed = new URL(value, base);
	} catch (e) {
		return false;
	}
	return SAFE_PROTOCOLS.has(parsed.protocol);
}

// Collect every URL-bearing field for one media descriptor. Galleries hold other
// descriptors, so they are walked rather than listed.
export function mediaUrls(options: any): string[] {
	if (!options || typeof options !== 'object') return [];
	switch (options.type) {
		case 'GALLERY':
			return [].concat(...(Array.isArray(options.src) ? options.src : []).map(mediaUrls));
		case 'IMAGE':
			// `downloadSrc` is what the save control fetches when a host shows a
			// preview and saves the original, so it is a URL that leaves the page
			// like any other and belongs under the same allowlist.
			return [options.src, options.href, options.downloadSrc].filter(Boolean);
		case 'VIDEO':
			return [
				options.href,
				options.source,
				options.poster,
				options.fallback,
				...[].concat(...(options.sources || []).map(source => [source.source, source.reverse])),
			].filter(Boolean);
		case 'AUDIO':
			return (options.sources || []).map(source => source.file).filter(Boolean);
		case 'IFRAME':
			return [options.embed, options.embedAutoplay].filter(Boolean);
		default:
			// TEXT is markup and is sanitized by the Text class. GENERIC_EXPANDO
			// builds its own element and carries no URL field.
			return [];
	}
}

export function assertSafeMediaUrls(options: any, base: string) {
	for (const url of mediaUrls(options)) {
		if (!isSafeMediaUrl(url, base)) {
			throw new Error(`Refusing to expand ${String(options.type)} media with an unsupported URL scheme`);
		}
	}
}
