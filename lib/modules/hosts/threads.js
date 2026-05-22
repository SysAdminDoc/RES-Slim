/* @flow */
// RES-Slim: Meta Threads embed via the documented `/embed/` URL suffix. No
// API, no oembed — Threads serves a pre-rendered iframe at the post URL
// with `/embed/` appended. This handler only inlines the iframe; it makes
// no API calls and never touches authenticated endpoints.

import { Host } from '../../core/host';

const PATTERN = /^https?:\/\/(?:www\.)?(threads\.com|threads\.net)\/@([\w.-]+)\/post\/([A-Za-z0-9_-]+)(?:[?#].*)?$/i;

export default new Host('threads', {
	name: 'threads',
	logo: '',
	permissions: ['https://www.threads.com/*', 'https://www.threads.net/*'],
	domains: ['threads.com', 'threads.net'],
	detect: ({ href }) => PATTERN.exec(href),
	async handleLink(href) {
		const m = PATTERN.exec(href);
		if (!m) return undefined;
		const domain = m[1];
		const user = m[2];
		const id = m[3];
		const embedUrl = `https://www.${domain}/@${user}/post/${id}/embed`;
		return {
			type: 'IFRAME',
			expandoClass: 'video-classic-expando-button',
			embed: {
				type: 'IFRAME',
				src: embedUrl,
				width: 540,
				height: 720,
			},
		};
	},
});
