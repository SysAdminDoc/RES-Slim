/* @flow */

import { Host } from '../../core/host';

const MIME_SUBTYPE = {
	ogv: 'video/ogg',
	mkv: 'video/x-matroska',
	'3gp': 'video/3gpp',
};

export default new Host('defaultVideo', {
	name: 'defaultVideo',
	domains: [],
	detect: ({ pathname }) => (/\.(webm|mp4|ogv|3gp|mkv)$/i).exec(pathname),
	handleLink(href, [, extension]) {
		// The extension is not always the MIME subtype. `canPlayType('video/mkv')`
		// and `canPlayType('video/3gp')` both answer '' in every engine, because
		// neither is a registered type — so those two links used to produce a
		// video element with no playable source at all.
		const format = MIME_SUBTYPE[extension.toLowerCase()] || `video/${extension}`;

		return {
			type: 'VIDEO',
			sources: [{
				source: href,
				type: format,
			}],
		};
	},
});
