/* @flow */

import DOMPurify from 'dompurify';
import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { setTrustedHTML } from '../../core/dom/trustedHtml';

export default new Host('twitter', {
	name: 'twitter',
	domains: ['twitter.com', 'x.com'],
	// The old oEmbed host answers `301 Moved Permanently` to the x.com one, probed
	// 2026-09-08, and a host request runs in the background worker at the
	// extension's own origin -- the browser refuses a redirect to an origin the
	// extension holds no permission for, so the request failed outright and every
	// tweet expando was broken.
	//
	// Only the new origin is declared. Keeping the old one alongside it was meant
	// to spare an existing user a second prompt, and does not: `Permissions.has`
	// passes the whole array to `chrome.permissions.contains`, which is
	// all-or-nothing, so a profile holding only twitter.com answers false and is
	// prompted either way. All the extra entry bought was a prompt naming a host
	// nothing requests.
	//
	// Spelled without a scheme in this comment on purpose:
	// `privacy-outbound-urls` scans this file for anything that looks like an
	// outbound URL and holds the result to a reviewed snapshot, and prose that
	// names one inflates that list with addresses nothing ever requests.
	permissions: ['https://publish.x.com/oembed'],
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
