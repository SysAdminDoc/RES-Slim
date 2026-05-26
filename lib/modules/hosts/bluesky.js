/* @flow */

import DOMPurify from 'dompurify';
import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { setTrustedHTML } from '../../core/dom/trustedHtml';

export default new Host('bluesky', {
	name: 'bluesky',
	logo: 'https://bsky.app/static/favicon.png',
	permissions: ['https://embed.bsky.app/oembed'],
	domains: ['bsky.app'],
	detect: ({ href }) => (/^https?:\/\/bsky\.app\/profile\/[\w.-]+\/post\/[\w.-]+(?:[?#].*)?$/i).exec(href),
	async handleLink(href) {
		const post = await ajax({
			url: 'https://embed.bsky.app/oembed',
			query: { url: href },
			type: 'json',
		});
		if (!post || typeof post !== 'object' || typeof post.html !== 'string') return undefined;

		const dummy = document.createElement('div');
		const sanitized = DOMPurify.sanitize(post.html);

		return {
			type: 'GENERIC_EXPANDO',
			muted: true,
			expandoClass: 'selftext',
			generate: () => dummy,
			onAttach: () => { setTrustedHTML(dummy, sanitized); },
		};
	},
});
