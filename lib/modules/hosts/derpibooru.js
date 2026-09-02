/* @flow */

import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { string } from '../../utils';

export default new Host('derpibooru', {
	name: 'Derpibooru',
	logo: 'https://derpibooru.org/favicon.ico',
	domains: [
	// cors: measured 2026-09-02 - derpibooru.org/api/v1/json answers 200 with
	// `Access-Control-Allow-Origin: *`, so no host permission is needed.
		'derpibooru.org',
		'trixiebooru.org',
		'derpiboo.ru', // Deprecated. Used for old links only.
		'derpicdn.net', // direct links
	],

	detect: ({ hostname, pathname }) => (hostname === 'derpicdn.net' ?
		(/^\/img\/view\/\d+\/\d+\/\d+\/(\d+)[._]/i).exec(pathname) :
		(/^\/(?:images\/)?(\d+)$/i).exec(pathname)
	),

	// v1, one request per image.
	//
	// This called `/api/v2/images/show.json?ids=…`, which batched up to fifty ids
	// into one request and answered 400 for every one of them on 2026-09-02; the
	// route looks retired. v1 has no equivalent: `/search/images?q=id:1 || id:2`
	// does return several, but it applies the site's default filter, so an image
	// that filter hides comes back as no result at all - which is exactly the case
	// an expando exists for. `/images/<id>` applies no filter, so the trade is one
	// request per link rather than one per fifty, on a host whose links are rare.
	handleLink: (() => {
		const maxDepth = 10;

		async function fetchImage(id: string, depth: number = 0) {
			// A missing id is a 404, which `ajax` rejects on; that is the same
			// outcome the old "No result" branch produced.
			const { image } = await ajax({
				url: `https://derpibooru.org/api/v1/json/images/${encodeURIComponent(id)}`,
				type: 'json',
			});

			if (!image) throw new Error('No result');

			// A duplicate carries the id it was merged into and no image of its own.
			if (image.duplicate_of) {
				if (depth > maxDepth) throw new Error(`Exceeded max duplicate depth: ${maxDepth}`);
				return fetchImage(String(image.duplicate_of), depth + 1);
			}

			// `view_url` is absent for a deleted or hidden image. The full
			// representation is the same file when both are present.
			const src = image.view_url || (image.representations && image.representations.full);
			if (!src) throw new Error('Image deleted or other error');

			return { src, description: image.description, source: image.source_url };
		}

		return async (href: string, [, id]: any) => {
			const { src, description, source } = await fetchImage(id);

			return {
				type: 'IMAGE',
				src,
				caption: description,
				credits: source ? string.escape`Source: <a href="${source}">${source}</a>` : undefined,
			};
		};
	})(),
});
