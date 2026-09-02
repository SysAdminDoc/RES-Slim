/* @flow */

import { Host } from '../../core/host';
import { ajax } from '../../environment';

export default new Host('streamable', {
	name: 'streamable',
	domains: ['streamable.com'],
	// cors: measured 2026-09-02 - api.streamable.com echoes the requesting origin in
	// `Access-Control-Allow-Origin`, so no host permission is needed.
	logo: 'https://cdn-e2.streamable.com/static/14a98f7cb1ddc5213329c039dc39cac543ba410f/img/favicon.ico',
	detect: ({ pathname }) => (/^\/(?:[es]\/)?(\w+)(?:\/\w+)?$/i).exec(pathname),
	async handleLink(href, [, hash]) {
		const data = await ajax({
			url: `https://api.streamable.com/videos/${hash}`,
			type: 'json',
		});

		// Streamable free videos auto-delete after 90 days without a view, and a
		// still-processing video returns 200 with no `files.mp4`. Bail cleanly so
		// showImages skips the expando instead of throwing on the destructure.
		const url = data && data.files && data.files.mp4 && data.files.mp4.url;
		if (!url) throw new Error('streamable: no playable file (deleted or still processing)');

		return {
			type: 'VIDEO',
			title: data.title,
			loop: true,
			sources: [{
				source: url,
				type: 'video/mp4',
			}],
			poster: data.thumbnail_url,
			source: data.source,
		};
	},
});
