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

// An artist's own sub-pages sit at `/<artist>/<tab>` and so look exactly like a
// track by segment count. `sets` is not here: a set has a name after it and is
// playable.
const PROFILE_TABS = new Set([
	'likes', 'tracks', 'albums', 'reposts', 'followers', 'following',
	'comments', 'playlists', 'popular-tracks', 'stats', 'insights',
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

		// An artist's own sub-pages are two segments too, so length alone does not
		// separate a track from a listing.
		if (PROFILE_TABS.has(segments[1].toLowerCase())) return false;

		// A private track carries a secret token as a third segment
		// (`/<artist>/<track>/s-XXXXXXX`), and a private set a fourth. The widget
		// resolves both, and they were playable before this handler had a detect at
		// all, so the token is what makes a longer path legitimate rather than a
		// comment permalink.
		const secret = segments[segments.length - 1].toLowerCase().startsWith('s-');

		if (segments[1].toLowerCase() === 'sets') return segments.length === 3 || (segments.length === 4 && secret);
		return segments.length === 2 || (segments.length === 3 && secret);
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
