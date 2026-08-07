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

// Deliberately empty. The obvious default, `api.cobalt.tools`, is the project's
// own hosted instance, and cobalt's docs state plainly that the hosted instances
// "use bot protection and are **not** intended to be used in other projects
// without explicit permission". It is also YouTube-blocked, so shipping it both
// violated the operator's terms and did not work. An unconfigured module now
// says so instead of firing a request that was never going to succeed.
export const DEFAULT_INSTANCE = '';

// Where to point someone who wants this feature.
export const SELF_HOSTING_DOCS = 'https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md';

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
	if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_INSTANCE;
	let v = raw.trim();
	if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(v)) v = `https://${v}`;
	let url;
	try {
		url = new URL(v);
	} catch (err) {
		return DEFAULT_INSTANCE;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_INSTANCE;
	if (!url.hostname) return DEFAULT_INSTANCE;
	url.username = '';
	url.password = '';
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/+$/, '') || DEFAULT_INSTANCE;
}

// Parse a comma/newline-separated list of Cobalt instances into sanitized,
// de-duplicated base URLs. The module tries them in order (health-check by
// attempt) so a dead instance falls through to the next. Returns an EMPTY list
// when nothing is configured — the caller must treat that as "not set up" and
// show the empty state, not as "use some default".
export function parseInstanceList(raw: mixed): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	const out: string[] = [];
	const seen: Set<string> = new Set();
	for (const piece of raw.split(/[,\n]+/)) {
		if (!piece.trim()) continue;
		const norm = sanitizeInstance(piece);
		if (seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out.filter(Boolean);
}

export function looksLikeStreamUrl(url: mixed): boolean {
	if (typeof url !== 'string') return false;
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch (err) {
		return false;
	}
}
