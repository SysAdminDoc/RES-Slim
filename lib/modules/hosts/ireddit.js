/* @flow */

import { Host } from '../../core/host';
import { getPostMetadata } from '../../utils';

// What an i.redd.it expando loads, decided 2026-08-29.
//
// It used to load `preview.source.url` — reddit's signed preview, which carries
// `auto=webp`. So the expando showed a re-encoded copy, and right-click, Save
// image as gave a `.webp` named after a `.png` post, because the signed URL's
// path still ends in `.png` while its bytes do not. Upstream #5483 is that
// complaint: the file people get, not the pixels on screen. The parameter cannot
// be stripped, because removing it invalidates the `s=` hmac.
//
// The decision is the original, with a ceiling. `href` is the untouched file and
// is directly loadable — this handler's own `detect` already requires an image
// extension on `i.redd.it` — so using it fixes the format and the resolution at
// once. What the preview was buying was a cap on the bytes an expando pulls
// inline, and that is worth keeping for the pathological cases: reddit accepts
// images up to 20MB, and a 100-megapixel panorama inline is a real cost.
//
// So: the original below the ceiling, the preview above it. `preview.source` is
// reddit's record of the *original's* dimensions (the downscales live in
// `resolutions`), so the size is known without fetching anything. And when the
// preview is used, the download control is still pointed at the original — the
// reader sees a capped image and saves the real file, which is the complaint
// answered either way.
//
// Pixels rather than bytes, because bytes are not in the metadata and a HEAD
// request per expando is a worse trade than a generous pixel bound. 24 megapixels
// is past every phone and camera photo and lands on the panoramas this is for.
const MAX_ORIGINAL_PIXELS = 24e6;

// Only an i.redd.it URL whose path names an image, which is the same shape
// `detect` requires before this handler runs at all.
export function originalImageUrl(value: mixed): ?string {
	if (typeof value !== 'string' || !value) return null;
	let url;
	try { url = new URL(value); } catch (e) { return null; }
	if (url.protocol !== 'https:' || url.hostname !== 'i.redd.it') return null;
	if (!(/\.(webp|gif|jpe?g|png|svg)$/i).test(url.pathname)) return null;
	return url.href;
}

export default new Host('ireddit', {
	name: 'i.redd.it',
	domains: ['i.redd.it'],
	attribution: false,
	detect({ pathname }, thing) { return (/\.(webp|gif|jpe?g|png|svg)$/i).test(pathname) && thing && thing.isLinkPost() && thing.getFullname(); },
	async handleLink(href, fullname) {
		let postMetadata = await getPostMetadata({ id: fullname.replace('t3_', '') });
		// Pick out original metadata if this is a crosspost
		if (postMetadata.crosspost_parent_list && postMetadata.crosspost_parent_list.length > 0) {
			postMetadata = postMetadata.crosspost_parent_list[0];
		}
		if (!postMetadata.preview) throw new Error('Post has no preview.');
		const preview = postMetadata.preview.images[0];
		if (preview.variants.mp4) {
			return {
				type: 'VIDEO',
				caption: postMetadata.selftext_html && postMetadata.selftext_html.replace(/<\/?p>/g, ''),
				loop: true,
				muted: true,
				fallback: preview.variants.gif && preview.variants.gif.source.url,
				sources: [{
					source: preview.variants.mp4.source.url,
					type: 'video/mp4',
				}],
			};
		} else {
			// A crosspost's metadata was swapped for its parent's above, so the
			// parent's own URL is the original rather than the link that was
			// followed. Guarded, because only an i.redd.it image URL is one this
			// handler is allowed to load.
			const original = originalImageUrl(postMetadata.url) || originalImageUrl(href) || preview.source.url;
			const pixels = Number(preview.source.width) * Number(preview.source.height);
			const tooLarge = Number.isFinite(pixels) && pixels > MAX_ORIGINAL_PIXELS;

			return {
				type: 'IMAGE',
				caption: postMetadata.selftext_html && postMetadata.selftext_html.replace(/<\/?p>/g, ''),
				src: tooLarge ? preview.source.url : original,
				// Always the original, even when the preview is what is shown.
				downloadSrc: original,
			};
		}
	},
});
