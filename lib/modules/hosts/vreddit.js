/* @flow */

import { difference, sortBy } from '../../utils/functional';
import { Host } from '../../core/host';
import { ajax } from '../../environment';
import { getPostMetadata } from '../../utils';

export default new Host('vreddit', {
	name: 'v.redd.it',
	domains: ['v.redd.it'],
	permissions: ['https://*.redd.it/*'],
	attribution: false,
	options: {
		forceReplaceNativeExpando: {
			title: 'showImagesForceReplaceNativeExpandoTitle',
			description: 'showImagesForceReplaceNativeExpandoDesc',
			value: false,
			type: 'boolean',
		},
		minimumVideoBandwidth: {
			title: 'showImagesVredditMinimumVideoBandwidthTitle',
			description: 'showImagesVredditMinimumVideoBandwidthDesc',
			value: '3000', // In kB/s
			type: 'text',
			advanced: true,
		},
	},
	detect({ pathname }, thing) { return thing && { fullname: thing.getFullname(), id: pathname.slice(1) }; },
	async handleLink(href, { fullname, id }) {
		const originalPlaylistUrl = `https://v.redd.it/${id}/DASHPlaylist.mpd`;
		const mpd = await ajax({ url: originalPlaylistUrl });
		const manifest = new DOMParser().parseFromString(mpd, 'text/xml');

		const minBandwidth = parseInt(this.options.minimumVideoBandwidth.value, 10) * 1000;
		const reps = Array.from(manifest.querySelectorAll('Representation[frameRate]'));
		const videoSourcesByBandwidth = sortBy(reps, rep => parseInt(rep.getAttribute('bandwidth'), 10))
			.reverse()
			.filter((rep, i, arr) => {
				const bandwidth = parseInt(rep.getAttribute('bandwidth'), 10);
				return rep === arr[0] || bandwidth >= minBandwidth;
			});

		// Removes unwanted entries from the from manifest
		for (const rep of difference(reps, videoSourcesByBandwidth)) rep.remove();

		// BaseURL is usually a relative URL -- it needs to be absolute since remote `mpd` file is converted to a blob
		//
		// Guarded, because it is not always there. A manifest that describes its
		// segments with `SegmentTemplate` instead carries no `BaseURL` at all, and
		// reading `.textContent` off the missing element threw out of the whole
		// handler -- so a video that dash could have played fine lost its expando
		// entirely rather than losing one representation.
		for (const rep of manifest.querySelectorAll('Representation')) {
			const baseURLElement = rep.querySelector('BaseURL');
			if (!baseURLElement || !baseURLElement.textContent) continue;
			baseURLElement.textContent = (new URL(baseURLElement.textContent, originalPlaylistUrl)).href;
		}

		// Audio is in a seperate stream, and requires a heavy dash dependency to add to the video
		const muted = !manifest.querySelector('AudioChannelConfiguration');

		if (!videoSourcesByBandwidth.length) throw new Error('Video has no valid sources');

		// Get postMetadata for video caption
		let postMetadata = await getPostMetadata({ id: fullname.replace('t3_', '') });
		// Pick out original metadata if this is a crosspost
		if (postMetadata.crosspost_parent_list && postMetadata.crosspost_parent_list.length > 0) {
			postMetadata = postMetadata.crosspost_parent_list[0];
		}

		// The direct-mp4 shortcut only works when every representation names one.
		// A `SegmentTemplate` manifest names none, and mapping over it produced a
		// list of `undefined` sources that played nothing; the manifest itself
		// still plays, so that is what it falls back to.
		const directSources = videoSourcesByBandwidth
			.map(rep => rep.querySelector('BaseURL'))
			.map(element => (element && element.textContent) || '');
		const everySourceIsDirect = directSources.length > 0 && directSources.every(Boolean);

		const sources = (muted && id && everySourceIsDirect) ?
			directSources.map(source => ({
				source,
				type: 'video/mp4',
			})) : [{
				source: (new XMLSerializer()).serializeToString(manifest),
				type: 'application/dash+xml',
			}];

		return {
			type: 'VIDEO',
			loop: true,
			caption: postMetadata.selftext_html && postMetadata.selftext_html.replace(/<\/?p>/g, ''),
			muted,
			sources,
		};
	},
});
