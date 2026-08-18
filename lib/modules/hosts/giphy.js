/* @flow */

import { Host } from '../../core/host';
import logo from '../../images/hosts/giphy-logo.png';

export default new Host('giphy', {
	name: 'giphy',
	domains: ['giphy.com'],
	logo,
	detect: ({ pathname }) => (/^(?:\/gifs|\/media|)\/(?:\w+-)*([^/.]+)(?:\/|\.gif|$)/i).exec(pathname),
	// No API call, and so no API key. `dc6zaTOxFJmzC` is Giphy's public beta key,
	// inherited from upstream - well known, shared by every project that ever
	// copied it, and revocable without notice by an owner this project is not.
	// The request bought nothing: `data.images.original.mp4` and `.url` resolve to
	// exactly these paths, so the roundtrip existed only to be told the URL the id
	// already determines. Verified 2026-08-18: both answer 200 with the right
	// content type, and `check:endpoints` keeps watching them.
	handleLink(href, [, id]) {
		return {
			type: 'VIDEO',
			fallback: `https://media.giphy.com/media/${id}/giphy.gif`,
			loop: true,
			muted: true,
			sources: [{
				source: `https://media.giphy.com/media/${id}/giphy.mp4`,
				type: 'video/mp4',
			}],
		};
	},
});
