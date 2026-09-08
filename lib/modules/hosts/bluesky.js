/* @flow */

import DOMPurify from 'dompurify';
import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { setTrustedHTML } from '../../core/dom/trustedHtml';
import { isPostLevelFailure, unavailableEmbed } from '../../utils/unavailableEmbed';

const unavailableMedia = () => unavailableEmbed({
	className: 'bluesky-embed bluesky-embed--unavailable',
	messageKey: 'blueskyExpandoUnavailable',
});

const bluesky = new Host('bluesky', {
	name: 'bluesky',
	logo: 'https://bsky.app/static/favicon.png',
	permissions: ['https://embed.bsky.app/oembed*'],
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
			// Private Bluesky posts return 403 from oEmbed, and a panel saying so is
			// the right answer for that. It is the wrong answer for a host that is
			// down: a panel counts as success, so answering one would hide the
			// outage from the penalty box and cost a failed round trip per link on
			// every page until it came back.
			if (!isPostLevelFailure(error)) throw error;
			return unavailableMedia();
		}
		if (!post || typeof post !== 'object' || typeof post.html !== 'string') return unavailableMedia();

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
