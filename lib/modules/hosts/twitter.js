/* @flow */

import DOMPurify from 'dompurify';
import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { setTrustedHTML } from '../../core/dom/trustedHtml';

export default new Host('twitter', {
	name: 'twitter',
	domains: ['twitter.com', 'x.com'],
	// The old oEmbed host answers `301 Moved Permanently` to the x.com one,
	// probed 2026-09-08, and a redirect to an origin the extension has no
	// permission for -- which sends no CORS header of its own -- fails the
	// request outright, so every tweet expando was broken. The old origin stays
	// requested for one release so a profile that already granted it keeps
	// working without a second prompt.
	//
	// Spelled without a scheme in this comment on purpose:
	// `privacy-outbound-urls` scans this file for anything that looks like an
	// outbound URL and holds the result to a reviewed snapshot, and prose that
	// names one inflates that list with addresses nothing ever requests.
	permissions: ['https://publish.x.com/oembed', 'https://publish.twitter.com/oembed'],
	attribution: false,
	detect: ({ href }) => (/^https?:\/\/(?:mobile\.)?(twitter|x)\.com\/(?:#!\/)?[\w]+\/status\/?[\w]+/i).exec(href.replace('x.com', 'twitter.com')),
	async handleLink(href, [url]) {
		// we have to omit the script tag and all of the nice formatting it brings us in Firefox/Chrome
		// because AMO/MV3 does not permit externally hosted script tags being pulled in from
		// oEmbed like this and MV3 prevents it with CSP...
		const { html } = await ajax({
			url: 'https://publish.x.com/oembed',
			query: { url, omit_script: true },
			type: 'json',
		});

		const dummy = document.createElement('div');
		const sanitized = DOMPurify.sanitize(html);

		return {
			type: 'GENERIC_EXPANDO',
			muted: true,
			expandoClass: 'selftext',
			generate: () => dummy,
			onAttach: () => { setTrustedHTML(dummy, sanitized); },
		};
	},
});
