/* @flow */

import { Host } from '../../core/host';

export default new Host('spotify', {
	name: 'spotify',
	domains: ['spotify.com'],
	logo: 'https://spotify.com/favicon.ico',
	/*
	* Match the following:
	* https://open.spotify.com/track/id
	* https://play.spotify.com/artist/id
	* https://play.spotify.com/album/id
	* https://open.spotify.com/user/someUser/playlist/id
	*
	* The id class was `[a-zA-z0-9]`, with a lowercase z. `A-z` spans the ASCII
	* range between Z and a, so it also accepted [ \ ] ^ _ and `, and a link
	* carrying any of them built an embed URI that cannot play. Usernames are
	* Spotify's own character set rather than \w, which excluded the hyphens and
	* dots real accounts use.
	*/
	detect: ({ href }) => (/^https:\/\/(?:open|play)\.spotify\.com\/((?:track|artist|album|user\/[a-zA-Z0-9._-]+\/playlist)\/[a-zA-Z0-9]+)$/i).exec(href),
	handleLink(href, [, uri]) {
		return {
			type: 'IFRAME',
			embed: `https://embed.spotify.com/?uri=spotify:${uri.replace(/\//g, ':')}`,
		};
	},
});
