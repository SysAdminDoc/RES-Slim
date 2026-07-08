/* @flow */

import { Host } from '../../core/host';
import { filterMap, getPostMetadata } from '../../utils';

/* eslint-disable camelcase */

export default new Host('redditgallery', {
	name: 'redditgallery',
	domains: ['reddit.com'],
	attribution: false,
	detect({ pathname }) { return pathname.match(/^\/gallery\/(\w+)/); },
	async handleLink(href, [, id]) {
		const {
			media_metadata = {},
			selftext_html,
			gallery_data: {
				items = [],
			} = {},
		} = await getPostMetadata({ id });
		const pieces = filterMap(items, ({ media_id, caption }) => {
			// `m` is something like `image/png`. Guard against a partial gallery
			// response where an item's metadata (or its `m`) is missing — otherwise
			// `m.startsWith` throws and kills the whole gallery expando.
			const { m } = media_metadata[media_id] || {};
			if (typeof m !== 'string') return undefined;
			const type = m.startsWith('image') ? 'IMAGE' : 'Unknown';
			return type === 'IMAGE' ? [{ type, caption, src: `https://i.redd.it/${media_id}.${m.substr(6)}` }] : undefined;
		});
		if (!pieces.length) throw new Error('Gallery has no valid pieces.');
		return { type: 'GALLERY', src: pieces, caption: selftext_html && selftext_html.replace(/<\/?p>/g, '') };
	},
});
