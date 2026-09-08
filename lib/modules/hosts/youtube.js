/* @flow */
// The embed needs no API key and never did. A `getVideoData` batch here carried
// a hardcoded Google API key - not this project's credential - to fetch title,
// duration and view count for a function that no file in the repo called: it was
// declared on Host, assigned by the constructor, and read nowhere. It shipped in
// the foreground bundle of every release regardless.

import { Host } from '../../core/host';

// A YouTube video id, and nothing else.
//
// The id goes straight into `https://www.youtube.com/embed/${id}`, and a query
// parameter is percent-decoded by the time it reaches here -- so `?v=..%2F..%2F
// redirect%3Fq%3Dhttps://evil.example` walked out of `/embed/` and framed
// `https://www.youtube.com/redirect?q=…` inside the Reddit page. The origin is
// pinned to youtube.com, so this is not script execution; it is an arbitrary
// YouTube page in a frame the reader believes is a video.
//
// Eleven characters is what YouTube actually issues, but the range is left wide
// because the id is theirs to change and refusing a real video is its own bug.
const VIDEO_ID = /^[\w-]{5,20}$/;

// A channel id is twenty-four characters, not eleven, and it lands in a query
// parameter rather than in the path -- so it gets its own shape rather than
// being squeezed through the video one.
const CHANNEL_ID = /^[\w-]{5,40}$/;

// Anchored, and `live` is listed rather than caught by accident.
//
// The old `/watch|embed|v/` matched any first segment containing a `v`, so
// `youtube.com/vanced` was read as a video page and produced `embed/undefined`.
// It also matched `live` -- "li-v-e" -- which is YouTube's current canonical
// share URL for a livestream or premiere, so anchoring the pattern without
// naming that route would have taken a working expando away.
const VIDEO_PATH = /^(watch|embed|v|live|shorts)$/i;

export default new Host('youtube', {
	name: 'youtube',
	attribution: false,
	domains: ['youtube.com', 'youtu.be'],
	detect: ({ pathname, hostname, searchParams }) => {
		// Every route below ends in an id that is about to be interpolated into an
		// embed URL, so each of them goes through the same gate. Returning nothing
		// means no expando, which is the right answer for a link that is not a
		// video.
		const video = id => (typeof id === 'string' && VIDEO_ID.test(id) ? [id, searchParams] : undefined);

		// split path excluding first /
		const split = pathname.substring(1).split('/');
		// livestream channel url
		if (split[0] === 'channel' && split[2] === 'live') {
			return CHANNEL_ID.test(split[1] || '') ? [`live_stream?channel=${split[1]}`, searchParams] : undefined;
		}
		// shorts url
		if (split[0] === 'shorts') return video(split[1]);
		// short url
		if (hostname.endsWith('youtu.be')) return video(split[0]);
		// long url
		//   ?v=
		const vParam = searchParams.get('v');
		if (vParam) return video(vParam);
		//   watch/embed/v
		if (VIDEO_PATH.test(split[0])) return video(split[1]);
		//   attribution_link
		const uParam = searchParams.get('u');
		if (split[0] === 'attribution_link' && uParam !== null) {
			const vParam = new URLSearchParams(uParam.split('?')[1]).get('v');
			if (vParam) return video(vParam);
		}
	},
	handleLink(href, [id, searchParams]) {
		const url = new URL(`https://www.youtube.com/embed/${id}`);
		url.searchParams.set('version', '3');
		url.searchParams.set('rel', '0');
		url.searchParams.set('enablejsapi', '1');

		const tParam = searchParams.get('t');
		if (tParam) {
			let start = 0;
			const timeBlocks = { h: 3600, m: 60, s: 1 };
			const timeRe = /[0-9]+[hms]/ig;
			// Get each segment e.g. 8m and calculate its value in seconds
			const timeMatch = tParam.match(timeRe);

			if (timeMatch) {
				for (const ts of timeMatch) {
					const unit = timeBlocks[ts.slice(-1)];
					const amount = parseInt(ts.slice(0, -1), 10);
					// Add each unit to start
					start += unit * amount;
				}
			} else {
				// support direct timestamp e.g. t=200
				start = parseInt(tParam, 10);
				if (isNaN(start)) start = 0;
			}
			url.searchParams.set('start', String(start));
		}

		for (const k of ['end', 'start', 'list']) {
			const param = searchParams.get(k);
			if (param) url.searchParams.set(k, param);
		}

		return {
			type: 'IFRAME',
			embed: url.href,
			embedAutoplay: `${url.href}&autoplay=1`,
			pause: '{"event":"command","func":"stopVideo","args":""}',
			play: '{"event":"command","func":"playVideo","args":""}',
			fixedRatio: true,
		};
	},
});
