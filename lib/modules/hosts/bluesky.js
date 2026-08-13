/* @flow */

import DOMPurify from 'dompurify';
import { Host } from '../../core/host';
import { ajax, i18n } from '../../environment';
import { setTrustedHTML } from '../../core/dom/trustedHtml';

function unavailableMedia() {
	const dummy = document.createElement('blockquote');
	return {
		type: 'GENERIC_EXPANDO',
		muted: true,
		expandoClass: 'selftext',
		generate: () => dummy,
		onAttach: () => {
			dummy.className = 'bluesky-embed bluesky-embed--unavailable';
			dummy.textContent = i18n('blueskyExpandoUnavailable');
		},
	};
}

const bluesky = new Host('bluesky', {
	name: 'bluesky',
	logo: 'https://bsky.app/static/favicon.png',
	permissions: ['https://embed.bsky.app/oembed'],
	domains: ['bsky.app'],
	// The profile segment is either a handle (user.bsky.social) or a DID
	// (did:plc:abc123). A `[\w.-]` class excludes the colons in a DID, so those
	// post URLs were silently never detected — upstream #5561.
	detect: ({ href }) => (/^https?:\/\/bsky\.app\/profile\/[^/]+\/post\/[\w.-]+\/*(?:[?#].*)?$/i).exec(href),
	async handleLink(href) {
		let post;
		try {
			post = await ajax({
				url: 'https://embed.bsky.app/oembed',
				// The oEmbed service rejects an otherwise valid post URL with a
				// trailing slash (upstream #5561).
				query: { url: href.replace(/\/+([?#]|$)/, '$1') },
				type: 'json',
			});
		} catch (error) {
			// Private Bluesky posts return 403 from oEmbed. Other transient failures
			// are equally unactionable in-page, so keep the expando stable and honest.
			return unavailableMedia();
		}
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

export default bluesky;
