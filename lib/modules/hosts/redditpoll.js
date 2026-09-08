/* @flow */

import { Host } from '../../core/host';

export default new Host('redditpoll', {
	name: 'redditpoll',
	domains: ['reddit.com'],
	attribution: false,
	detect({ pathname }) { return pathname.match(/^\/poll\/(\w+)/); },
	handleLink(href, [, id]) {
		return {
			type: 'IFRAME',
			// Reddit's own origin, which on current Reddit is the page's origin too.
			// A sandboxed frame that is same-origin with its embedder can take the
			// sandbox off, so this one is framed without `allow-same-origin`. The
			// poll renders from its URL and does not need it.
			sameOrigin: true,
			expandoClass: 'selftext',
			embed: `https://www.reddit.com/poll/${id}/`,
			height: '500px',
			width: '700px',
		};
	},
});
