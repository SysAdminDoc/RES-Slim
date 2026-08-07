/* @flow */

// Build reverse-image-search URLs for a post's image.
//
// Every engine here takes the image URL as a plain query parameter, so the
// lookup happens entirely in the tab the user opens — RES-Slim never uploads
// the image or contacts the engine itself. That is the whole reason the older
// "Reddit Image Search Add-on" style scripts are safe to reimplement: the
// feature is link construction, not a network integration.

export type ReverseSearchEngine = {|
	id: string,
	name: string,
	build: (imageUrl: string) => string,
|};

export const ENGINES: ReverseSearchEngine[] = [
	{
		id: 'lens',
		name: 'Google Lens',
		build: url => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`,
	},
	{
		id: 'yandex',
		name: 'Yandex',
		build: url => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}`,
	},
	{
		id: 'tineye',
		name: 'TinEye',
		build: url => `https://tineye.com/search?url=${encodeURIComponent(url)}`,
	},
	{
		id: 'bing',
		name: 'Bing',
		build: url => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(url)}`,
	},
	{
		id: 'saucenao',
		name: 'SauceNAO',
		build: url => `https://saucenao.com/search.php?url=${encodeURIComponent(url)}`,
	},
];

export const ENGINE_IDS: string[] = ENGINES.map(e => e.id);

// An engine can only look up an image it can fetch itself, so anything that is
// not an absolute http(s) URL is useless: blob:, data:, and same-origin relative
// paths all produce a search page that errors after the user has already left
// reddit. Reject them here rather than rendering a button that cannot work.
export function isSearchableImageUrl(url: ?string): boolean {
	if (typeof url !== 'string' || !url) return false;
	let parsed;
	try {
		parsed = new URL(url);
	} catch (e) {
		return false;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
	// A bare host with no path is not an image.
	return parsed.pathname.length > 1;
}

export function reverseSearchUrls(imageUrl: string, enabledIds: string[] = ENGINE_IDS): Array<{| id: string, name: string, url: string |}> {
	if (!isSearchableImageUrl(imageUrl)) return [];
	const wanted = new Set(enabledIds);
	return ENGINES
		.filter(engine => wanted.has(engine.id))
		.map(engine => ({ id: engine.id, name: engine.name, url: engine.build(imageUrl) }));
}

// old.reddit thumbnails are downscaled proxies; searching one finds nothing.
// Prefer the post's own link, falling back to the preview host only when the
// link is not itself an image.
const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|bmp|avif)(\?|$)/i;

export function bestImageUrlFor(postLink: ?string, thumbnail: ?string): ?string {
	if (typeof postLink === 'string' && IMAGE_EXTENSION.test(postLink) && isSearchableImageUrl(postLink)) {
		return postLink;
	}
	// preview.redd.it and i.redd.it links without an extension are still images.
	if (typeof postLink === 'string' && isSearchableImageUrl(postLink)) {
		try {
			const { hostname } = new URL(postLink);
			if (hostname === 'i.redd.it' || hostname === 'preview.redd.it' || hostname === 'i.imgur.com') return postLink;
		} catch (e) { /* fall through */ }
	}
	if (typeof thumbnail === 'string' && isSearchableImageUrl(thumbnail)) return thumbnail;
	return null;
}
