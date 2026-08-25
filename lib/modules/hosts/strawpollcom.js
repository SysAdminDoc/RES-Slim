/* @flow */

import { Host } from '../../core/host';

export default new Host('strawpoll.com', {
	name: 'strawpoll.com',
	domains: ['strawpoll.com'],
	attribution: false,
	// strawpoll.com serves a poll at `/<id>`, `/polls/<id>` and `/embed/<id>`.
	// Without the `polls/` alternative the first path segment is captured as the
	// id, so every `/polls/<id>` link expanded to a poll literally called "polls".
	detect: ({ pathname }) => (/^\/(?:embed\/|polls\/)?([a-z0-9]+)/i).exec(pathname),
	handleLink(href, [, id]) {
		return {
			type: 'IFRAME',
			expandoClass: 'selftext',
			muted: true,
			embed: `https://strawpoll.com/embed/${id}`,
			height: '450px',
			width: '700px',
		};
	},
});
