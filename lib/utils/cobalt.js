/* @flow */
// Pure helpers for the cobaltDownloader module. Decides whether a post is
// cobalt-eligible based on its data-domain, builds the request body for the
// cobalt.tools API, and normalises the response. Dependency-free for
// unit testing.

export type CobaltOptions = {|
	url: string,
	videoQuality: string,    // '144' '240' '360' '480' '720' '1080' '1440' '2160' 'max'
	audioFormat: string,     // 'best' 'mp3' 'opus' 'wav' 'm4a'
	downloadMode: string,    // 'auto' 'audio' 'mute'
	filenameStyle: string,   // 'classic' 'pretty' 'basic' 'nerdy'
|};

export type CobaltResponse =
	| {| status: 'tunnel' | 'redirect' | 'stream', url: string, filename?: string |}
	| {| status: 'picker', picker: $ReadOnlyArray<{| url: string, type?: string, thumb?: string |}>, audio?: string |}
	| {| status: 'error', error: { code: string } |}
	| {| status: 'local-processing', url: string |};

export const DEFAULT_HOSTS: $ReadOnlyArray<string> = Object.freeze([
	// host matchers as substrings of data-domain
	'youtube.com', 'youtu.be',
	'twitter.com', 'x.com', 't.co',
	'tiktok.com', 'vm.tiktok.com',
	'instagram.com',
	'reddit.com', 'v.redd.it',
	'twitch.tv', 'clips.twitch.tv',
	'streamable.com',
	'soundcloud.com',
	'vimeo.com',
	'bilibili.com',
	'pinterest.com',
	'facebook.com', 'fb.watch',
	'tumblr.com',
	'rumble.com',
	'bsky.app',
	'dailymotion.com',
	'vk.com',
	'snapchat.com',
	'loom.com',
	'ok.ru',
]);

export function isCobaltEligible(domain: mixed, allowed: $ReadOnlyArray<string>): boolean {
	if (typeof domain !== 'string') return false;
	const d = domain.toLowerCase();
	if (!d) return false;
	for (const candidate of allowed) {
		if (d === candidate) return true;
		if (d.endsWith(`.${candidate}`)) return true;
	}
	return false;
}

export function parseHostList(raw: mixed): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_HOSTS.slice();
	const out: string[] = [];
	const seen: Set<string> = new Set();
	for (const piece of raw.split(/[,\s\n]+/)) {
		const norm = piece.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out.length ? out : DEFAULT_HOSTS.slice();
}

export function buildRequestBody(opts: CobaltOptions): { [string]: mixed } {
	return {
		url: opts.url,
		videoQuality: opts.videoQuality,
		audioFormat: opts.audioFormat,
		downloadMode: opts.downloadMode,
		filenameStyle: opts.filenameStyle,
	};
}

export function sanitizeInstance(raw: mixed): string {
	if (typeof raw !== 'string' || !raw.trim()) return 'https://api.cobalt.tools';
	let v = raw.trim();
	if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
	return v.replace(/\/+$/, '');
}

export function looksLikeStreamUrl(url: mixed): boolean {
	if (typeof url !== 'string') return false;
	return /^https?:\/\//i.test(url);
}
