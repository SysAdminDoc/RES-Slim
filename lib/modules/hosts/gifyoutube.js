/* @flow */

import { Host } from '../../core/host';
import { DAY } from '../../utils';
import { ajax } from '../../environment';

export default new Host('gifs', {
	name: 'gifs.com',
	domains: ['gifs.com', 'gifyoutube.com', 'gifyt.com'],
	// cors: not measurable 2026-09-02 - gifs.com serves an expired certificate, so
	// every request to it fails before CORS is reached, from a script and from a
	// real browser alike. Nothing to permit; see ROADMAP.
	logo: 'https://cdn.gifs.com/resources/favicon.png',
	detect: ({ href }) => (
		(/^https?:\/\/(?:beta\.|www\.)?(?:gifyoutube|gifyt)\.com\/gif\/(\w+)\.?/i).exec(href) ||
		(/^https?:\/\/share\.gifyoutube\.com\/(\w+)\.gif/i).exec(href)
	),
	async handleLink(href, [, id]) {
		const { sauce } = await ajax({
			url: `https://gifs.com/api/${id}`,
			type: 'json',
			cacheFor: DAY,
		});

		return {
			type: 'VIDEO',
			loop: true,
			fallback: `https://share.gifyoutube.com/${id}.gif`,
			muted: true,
			source: sauce,
			sources: [{
				source: `https://share.gifyoutube.com/${id}.webm`,
				type: 'video/webm',
			}, {
				source: `https://share.gifyoutube.com/${id}.mp4`,
				type: 'video/mp4',
			}],
		};
	},
});
