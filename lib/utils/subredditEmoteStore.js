/* @flow */
// The emoji cache lives in the extension's own database, alongside the other
// local data sets, so the settings page can count and purge it without a Reddit
// tab open. See `lib/utils/featureStores.js`.

import { canPersistFeatureData } from '../environment';
import { readRecord, readRecords, writeRecords } from '../environment/foreground/featureDb';

import { CACHE_CAP } from './subredditEmotes';
import type { SubredditEmoteCacheRecord } from './subredditEmotes';

export function readEmoteCache(subreddit: string): Promise<?SubredditEmoteCacheRecord> {
	if (!canPersistFeatureData('subredditEmotes')) return Promise.resolve(null);
	return readRecord('subredditEmotes', subreddit.toLowerCase());
}

export async function writeEmoteCache(record: SubredditEmoteCacheRecord, ttlMs: number): Promise<void> {
	if (!canPersistFeatureData('subredditEmotes')) return;
	await writeRecords('subredditEmotes', [record]);

	const now = Date.now();
	const records: SubredditEmoteCacheRecord[] = await readRecords('subredditEmotes');
	const expired = records.filter(item => now - item.fetchedAt > ttlMs).map(item => item.subreddit);
	const live = records.filter(item => !expired.includes(item.subreddit)).sort((a, b) => b.fetchedAt - a.fetchedAt);
	const overCap = live.slice(CACHE_CAP).map(item => item.subreddit);
	await writeRecords('subredditEmotes', [], [...expired, ...overCap]);
}
