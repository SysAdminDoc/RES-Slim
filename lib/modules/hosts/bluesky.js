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
	// The profile segment is either a handle (user.bsky.social) or a DID
	// (did:plc:abc123). A `[\w.-]` class excludes the colons in a DID, so those
	// post URLs were silently never detected — upstream #5561.
	detect: ({ href }) => (/^https?:\/\/bsky\.app\/profile\/[^/]+\/post\/[\w.-]+(?:[?#].*)?$/i).exec(href),
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
