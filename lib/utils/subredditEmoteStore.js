/* @flow */

import {
	CACHE_CAP,
	DB_NAME,
	SCHEMA_VERSION,
	STORE_NAME,
} from './subredditEmotes';
import type { SubredditEmoteCacheRecord } from './subredditEmotes';

let dbPromise: ?Promise<any> = null;

function openDb(): Promise<any> {
	if (dbPromise) return dbPromise;
	const pending = new Promise((resolve, reject) => {
		try {
			const request: any = indexedDB.open(DB_NAME, SCHEMA_VERSION);
			request.onupgradeneeded = (event: any) => {
				const db = event.target.result;
				if (event.oldVersion === 0) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: 'subreddit' });
					store.createIndex('fetchedAt', 'fetchedAt');
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		} catch (error) { reject(error); }
	});
	dbPromise = pending;
	pending.catch(() => { dbPromise = null; });
	return pending;
}

export async function readEmoteCache(subreddit: string): Promise<?SubredditEmoteCacheRecord> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, 'readonly');
		const request: any = transaction.objectStore(STORE_NAME).get(subreddit.toLowerCase());
		request.onsuccess = () => resolve(request.result || null);
		request.onerror = () => reject(request.error);
	});
}

async function allRecords(): Promise<SubredditEmoteCacheRecord[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, 'readonly');
		const request: any = transaction.objectStore(STORE_NAME).getAll();
		request.onsuccess = () => resolve(request.result || []);
		request.onerror = () => reject(request.error);
	});
}

async function deleteRecords(subreddits: string[]): Promise<void> {
	if (!subreddits.length) return;
	const db = await openDb();
	await new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		for (const subreddit of subreddits) store.delete(subreddit);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
}

export async function writeEmoteCache(record: SubredditEmoteCacheRecord, ttlMs: number): Promise<void> {
	const db = await openDb();
	await new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).put(record);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});

	const now = Date.now();
	const records = await allRecords();
	const expired = records.filter(item => now - item.fetchedAt > ttlMs).map(item => item.subreddit);
	const live = records.filter(item => !expired.includes(item.subreddit)).sort((a, b) => b.fetchedAt - a.fetchedAt);
	const overCap = live.slice(CACHE_CAP).map(item => item.subreddit);
	await deleteRecords([...expired, ...overCap]);
}
