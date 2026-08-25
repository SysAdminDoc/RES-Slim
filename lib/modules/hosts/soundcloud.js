/* @flow */

import { Host } from '../../core/host';
import { string } from '../../utils';

// `detect: () => true` gave every soundcloud.com URL an expando, including the
// ones the widget cannot play: the site's own navigation pages, a bare artist
// profile, a search. The widget answers those with an error panel, so the button
// existed only to produce one. Upstream carries this as #5568.
//
// What the widget does resolve is a track (`/<artist>/<track>`), a set
// (`/<artist>/sets/<name>`), and the `on.soundcloud.com` short link. Those are
// the three shapes below. `/you`, `/discover`, `/search`, `/stream`, `/upload`,
// `/settings`, `/pages` and `/tags` are the site's own pages under the same
// one-segment shape as an artist profile, so they are named rather than inferred.
const SITE_PAGES = new Set([
	'discover', 'search', 'stream', 'upload', 'you', 'settings', 'pages', 'tags',
	'charts', 'feed', 'imprint', 'people', 'popular', 'terms-of-use', 'jobs',
	'mobile', 'creators', 'pro',
]);

export default new Host('soundcloud', {
	name: 'soundcloud',
	domains: ['soundcloud.com'],
	logo: 'https://a-v2.sndcdn.com/assets/images/sc-icons/favicon-2cadd14b.ico',
	detect({ hostname, pathname }) {
		// The short-link domain resolves on the widget's side, so anything under it
		// is playable.
		if (hostname === 'on.soundcloud.com') return pathname.length > 1;

		const segments = pathname.split('/').filter(Boolean);
		if (segments.length < 2) return false;
		if (SITE_PAGES.has(segments[0].toLowerCase())) return false;

		// `/<artist>/<track>` and `/<artist>/sets/<name>`. Anything deeper is a
		// comment permalink or a settings sub-page, neither of which the widget
		// plays.
		if (segments[1].toLowerCase() === 'sets') return segments.length === 3;
		return segments.length === 2;
	},
	handleLink(href) {
		return {
			type: 'IFRAME',
			embed: string.encode`https://w.soundcloud.com/player/?url=${href}`,
			height: '166px',
			width: '700px',
			pause: '{"method":"pause"}',
			play: '{"method":"play"}',
		};
	},
});
