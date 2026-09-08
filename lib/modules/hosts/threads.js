/* @flow */
// RES-Slim: Meta Threads embed via the documented `/embed/` URL suffix. No
// API, no oembed — Threads serves a pre-rendered iframe at the post URL
// with `/embed/` appended. This handler only inlines the iframe; it makes
// no API calls and never touches authenticated endpoints.

import { Host } from '../../core/host';
import { unavailableEmbed } from '../../utils/unavailableEmbed';

const unavailable = () => unavailableEmbed({
	className: 'threads-embed threads-embed--unavailable',
	messageKey: 'threadsExpandoUnavailable',
	// The same button the working embed gets, so one link does not change icon
	// depending on whether the post is still there.
	expandoClass: 'video-classic-expando-button',
});

const PATTERN = /^https?:\/\/(?:www\.)?(threads\.com|threads\.net)\/@([\w.-]+)\/post\/([A-Za-z0-9_-]+)(?:[?#].*)?$/i;

export default new Host('threads', {
	name: 'threads',
	logo: '',
	permissions: ['https://www.threads.com/*', 'https://www.threads.net/*'],
	domains: ['threads.com', 'threads.net'],
	detect: ({ href }) => PATTERN.exec(href),
	handleLink(href) {
		const m = PATTERN.exec(href);
		// A panel that says so, not `undefined`: `completeExpando` reads `.title`
		// off the result, so `undefined` is a TypeError the scanner records against
		// this host.
		if (!m) return unavailable();
		const domain = m[1];
		const user = m[2];
		const id = m[3];
		const embedUrl = `https://www.${domain}/@${user}/post/${id}/embed`;
		// `embed` is the URL string, not a nested media object. It was the latter
		// for this handler's whole life, which meant `assertSafeMediaUrls` refused
		// every Threads link before it rendered — the type-check there reads
		// `embed` as a string, so an object fails it — and the throw was swallowed
		// by the expand handler, leaving a button that did nothing on every click.
		// `width`/`height` are CSS lengths because `iframeTemplate` interpolates
		// them straight into a `style` attribute.
		return {
			type: 'IFRAME',
			expandoClass: 'video-classic-expando-button',
			embed: embedUrl,
			width: '540px',
			height: '720px',
		};
	},
});
