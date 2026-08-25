/* @flow */

import { Host } from '../../core/host';

// RedGifs serves the same clip under four spellings, and the old detect only
// knew two of them:
//   redgifs.com/watch/<id>   the page a user copies from the address bar
//   redgifs.com/ifr/<id>     the embed the player itself uses
//   redgifs.com/i/<id>       the short share link
//   i.redgifs.com/i/<id>     the same short link on the image subdomain
// `i.redgifs.com` links are what reddit's own domain listing is full of, so
// leaving that spelling out meant the expando button never appeared for them.
//
// The v1 metadata call this host used to make (api.redgifs.com/v1/gfycats/<id>)
// was retired: it answers 404 for every id, verified 2026-08-25. v2 exists but
// requires a per-client bearer token this project does not own and will not
// hardcode, the same call that removed the inherited keys in v0.40.0. So the
// request was pure latency - it could only ever throw, and every expando already
// fell through to the fixed-ratio embed below. Building that embed directly
// drops one guaranteed-failing network round trip per expanded link.
export default new Host('redgifs', {
	name: 'redgifs',
	domains: ['redgifs.com'],
	logo: 'https://redgifs.com/assets/favicon.ico',
	detect: ({ pathname }) => (/^\/(?:ifr|watch|i)\/(\w+)/i).exec(pathname),
	handleLink(href, [, id]) {
		const embed = `https://redgifs.com/ifr/${id}`;

		return {
			type: 'IFRAME',
			embed: `${embed}?autoplay=0`,
			embedAutoplay: embed,
			fixedRatio: true,
			muted: true,
		};
	},
});
