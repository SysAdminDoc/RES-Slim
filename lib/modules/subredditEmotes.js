/* @flow */

// The token and metadata shape follows Auxermen's "Emojis for old reddit"
// userscript. The catalog API requires OAuth and returned 403 in a signed-in
// browser on 2026-08-21, while the thread JSON returned the media_metadata used
// by Reddit itself. Cache those observed per-thread maps by subreddit instead.

import { Module } from '../core/module';
import { isPageType, Thing, watchForThings } from '../utils';
import { fetchRedditJson, isRedditListingPair } from '../utils/redditJson';
import {
	DEFAULT_TTL_MS,
	buildCacheRecord,
	extractSubredditEmotes,
	isFreshRecord,
	isThreadFresh,
	renderKnownEmotes,
} from '../utils/subredditEmotes';
import { readEmoteCache, writeEmoteCache } from '../utils/subredditEmoteStore';

import type { ModuleOption } from '../core/module';
import type { SubredditEmoteCacheRecord, SubredditEmoteMap } from '../utils/subredditEmotes';
import { notifyRedditApiBlocked } from './notifications';

type RawOptions = { [string]: any };
type SubredditEmoteOptions = { [string]: ModuleOption<RawOptions> };

export const module: Module<RawOptions, SubredditEmoteOptions> = new Module('subredditEmotes');

module.moduleName = 'Subreddit emoji in comments';
module.category = 'commentsCategory';
module.description = 'Render subreddit-specific emoji tokens in old Reddit comments. Metadata stays in a bounded local cache and is fetched through the signed-in Reddit session.';
module.disabledByDefault = true;
module.include = ['r2'];
module.asLongAs = [() => isPageType('comments')];
module.keywords = ['emoji', 'emote', 'comments', 'old reddit', 'media'];

module.options = {
	cacheHours: {
		type: 'text',
		value: '168',
		title: 'Metadata cache TTL (hours)',
		description: 'How long a fetched thread emoji map stays valid. The default is seven days.',
	},
};

let emotes: SubredditEmoteMap = {};
let ready = false;
const queuedThings: Set<Thing> = new Set();

function ttlMs(): number {
	const option = module.options.cacheHours;
	const hours = Number(option.type === 'text' ? option.value : '168');
	if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_TTL_MS;
	return Math.max(60 * 60 * 1000, Math.min(90 * 24 * 60 * 60 * 1000, hours * 60 * 60 * 1000));
}

function subredditFromLocation(): string {
	const match = /^\/r\/([^/]+)\/comments\//i.exec(location.pathname);
	return match ? decodeURIComponent(match[1]).toLowerCase() : '';
}

function threadPath(): string {
	return location.pathname.replace(/\/$/, '');
}

function renderThing(thing: Thing): void {
	const element = thing.element;
	if (!(element instanceof HTMLElement)) return;
	const body = element.querySelector(':scope > .entry .usertext-body .md, :scope > .entry .usertext-body');
	if (body instanceof HTMLElement) renderKnownEmotes(body, emotes);
}

function processThing(thing: Thing): void {
	if (!ready) {
		queuedThings.add(thing);
		return;
	}
	renderThing(thing);
}

function flushQueuedThings(): void {
	for (const thing of queuedThings) renderThing(thing);
	queuedThings.clear();
}

async function initialize(signal: any): Promise<void> {
	const subreddit = subredditFromLocation();
	const path = threadPath();
	if (!subreddit || !path) {
		ready = true;
		flushQueuedThings();
		return;
	}

	const ttl = ttlMs();
	const now = Date.now();
	let cached: ?SubredditEmoteCacheRecord = null;
	try {
		cached = await readEmoteCache(subreddit);
	} catch (error) {
		console.warn('RES-Slim subredditEmotes: local cache could not be read', error);
	}

	if (cached && isFreshRecord(cached, now, ttl)) {
		emotes = cached.emotes;
		ready = true;
		flushQueuedThings();
		if (isThreadFresh(cached, path, now, ttl)) return;
	}

	try {
		const response = await fetchRedditJson(`${path}.json?raw_json=1&limit=500&depth=10`, {
			signal,
			onStatus: notifyRedditApiBlocked,
			validate: isRedditListingPair,
		});
		const found = extractSubredditEmotes(response);
		const record = buildCacheRecord(subreddit, path, found, cached, Date.now(), ttl);
		emotes = record.emotes;
		try {
			await writeEmoteCache(record, ttl);
		} catch (error) {
			console.warn('RES-Slim subredditEmotes: local cache could not be updated', error);
		}
	} catch (error) {
		if (!error || error.name !== 'AbortError') console.warn('RES-Slim subredditEmotes: Reddit metadata request failed', error);
	} finally {
		ready = true;
		flushQueuedThings();
	}
}

module.contentStart = signal => {
	watchForThings(['comment'], processThing);
	initialize(signal);
};
