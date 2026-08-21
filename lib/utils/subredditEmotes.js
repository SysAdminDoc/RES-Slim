/* @flow */

export const DB_NAME = 'rsm-subredditEmotes';
export const STORE_NAME = 'maps';
export const SCHEMA_VERSION = 1;
export const CACHE_CAP = 250;
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SubredditEmote = {|
	token: string,
	url: string,
	width: number,
	height: number,
|};

export type SubredditEmoteMap = { [string]: SubredditEmote };

export type SubredditEmoteCacheRecord = {|
	subreddit: string,
	fetchedAt: number,
	emotes: SubredditEmoteMap,
	threads: { [string]: number },
|};

export type EmoteTextSegment =
	| {| type: 'text', value: string |}
	| {| type: 'emote', token: string, emote: SubredditEmote |};

const TOKEN_RE = /:([A-Za-z0-9_-]{1,100}):/g;
const ALLOWED_IMAGE_HOSTS = new Set([
	'emoji.redditmedia.com',
	'i.redd.it',
	'preview.redd.it',
	'redditstatic.com',
	'www.redditstatic.com',
]);

function asObject(value: mixed): ?{ [string]: any } {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value: any) : null;
}

function imageUrl(value: mixed): ?string {
	if (typeof value !== 'string' || !value) return null;
	const decoded = value.replace(/&amp;/g, '&');
	try {
		const parsed = new URL(decoded);
		if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
		return parsed.toString();
	} catch (error) {
		return null;
	}
}

function dimension(value: mixed): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 20;
	return Math.max(1, Math.min(256, Math.round(parsed)));
}

function emoteFromMetadata(id: string, value: mixed): ?SubredditEmote {
	const parts = id.split('|');
	if (parts.length !== 3 || parts[0] !== 'emote' || !/^t5_[a-z0-9]+$/i.test(parts[1])) return null;
	const token = parts[2];
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(token)) return null;
	const metadata = asObject(value);
	const source = metadata && asObject(metadata.s);
	if (!source) return null;
	const url = imageUrl(source.u) || imageUrl(source.gif);
	if (!url) return null;
	return {
		token,
		url,
		width: dimension(source.x),
		height: dimension(source.y),
	};
}

function collectListing(listing: mixed, out: SubredditEmoteMap): void {
	const root = asObject(listing);
	const data = root && asObject(root.data);
	if (!data || !Array.isArray(data.children)) return;
	for (const childValue of data.children) {
		const child = asObject(childValue);
		const comment = child && child.kind === 't1' ? asObject(child.data) : null;
		if (!comment) continue;
		const metadata = asObject(comment.media_metadata);
		if (metadata) {
			for (const id of Object.keys(metadata)) {
				const emote = emoteFromMetadata(id, metadata[id]);
				if (emote) out[emote.token] = emote;
			}
		}
		collectListing(comment.replies, out);
	}
}

export function extractSubredditEmotes(response: mixed): SubredditEmoteMap {
	const out: SubredditEmoteMap = {};
	if (!Array.isArray(response) || response.length < 2) return out;
	collectListing(response[1], out);
	return out;
}

export function splitEmoteText(value: string, emotes: SubredditEmoteMap): EmoteTextSegment[] {
	const segments: EmoteTextSegment[] = [];
	let offset = 0;
	TOKEN_RE.lastIndex = 0;
	let match;
	while ((match = TOKEN_RE.exec(value))) {
		const emote = emotes[match[1]];
		if (!emote) continue;
		if (match.index > offset) segments.push({ type: 'text', value: value.slice(offset, match.index) });
		segments.push({ type: 'emote', token: match[0], emote });
		offset = match.index + match[0].length;
	}
	if (!segments.length) return [{ type: 'text', value }];
	if (offset < value.length) segments.push({ type: 'text', value: value.slice(offset) });
	return segments;
}

export function renderKnownEmotes(root: HTMLElement, emotes: SubredditEmoteMap): number {
	if (!root || !Object.keys(emotes).length) return 0;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes = [];
	let current;
	while ((current = walker.nextNode())) nodes.push(current);
	let rendered = 0;
	for (const node of nodes) {
		const parent = node.parentElement;
		if (!parent || parent.closest('a, code, pre, script, style, textarea, .rsm-subredditEmote')) continue;
		const text = node.nodeValue || '';
		const segments = splitEmoteText(text, emotes);
		if (!segments.some(segment => segment.type === 'emote')) continue;
		const fragment = document.createDocumentFragment();
		for (const segment of segments) {
			if (segment.type === 'text') {
				fragment.append(document.createTextNode(segment.value));
				continue;
			}
			const img = document.createElement('img');
			img.className = 'rsm-subredditEmote';
			img.src = segment.emote.url;
			img.alt = segment.token;
			img.title = segment.token;
			img.setAttribute('loading', 'lazy');
			img.setAttribute('decoding', 'async');
			img.dataset.rsmSubredditEmote = segment.emote.token;
			fragment.append(img);
			rendered += 1;
		}
		node.replaceWith(fragment);
	}
	return rendered;
}

export function isFreshRecord(record: mixed, now: number, ttlMs: number): boolean {
	const value = asObject(record);
	if (!value || typeof value.subreddit !== 'string' || !asObject(value.emotes) || !asObject(value.threads)) return false;
	const fetchedAt = Number(value.fetchedAt);
	return Number.isFinite(fetchedAt) && fetchedAt <= now && now - fetchedAt <= ttlMs;
}

export function isThreadFresh(record: mixed, threadPath: string, now: number, ttlMs: number): boolean {
	if (!isFreshRecord(record, now, ttlMs)) return false;
	const timestamp = Number((record: any).threads[threadPath]);
	return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= ttlMs;
}

export function buildCacheRecord(
	subreddit: string,
	threadPath: string,
	emotes: SubredditEmoteMap,
	previous: ?SubredditEmoteCacheRecord,
	now: number,
	ttlMs: number,
): SubredditEmoteCacheRecord {
	const priorEmotes = previous && isFreshRecord(previous, now, ttlMs) ? previous.emotes : {};
	const priorThreads = previous && isFreshRecord(previous, now, ttlMs) ? previous.threads : {};
	const threads = {};
	for (const path of Object.keys(priorThreads)) {
		if (now - priorThreads[path] <= ttlMs) threads[path] = priorThreads[path];
	}
	threads[threadPath] = now;
	return {
		subreddit: subreddit.toLowerCase(),
		fetchedAt: now,
		emotes: { ...priorEmotes, ...emotes },
		threads,
	};
}
