/* @flow */
// Pure helpers for the savedBackup module. Normalises the paginated reddit
// listing response and shapes the export payload. Persistent operations consult
// the foreground private-context policy before opening IndexedDB.

import { canPersistFeatureData } from '../environment';

export type SavedItem = {|
	kind: 't1' | 't3',
	fullname: string,
	id: string,
	subreddit: string,
	author: string,
	permalink: string,
	createdUtc: number,
	body: string, // comment body OR post selftext
	title: string, // post title OR ''
	url: string, // post URL OR ''
	score: number,
|};

export type SavedExport = {|
	username: string,
	exportedAt: number,
	schemaVersion: number,
	count: number,
	items: SavedRecord[],
|};


export type SavedRecord = {|
	username: string,
	kind: 't1' | 't3',
	fullname: string,
	id: string,
	subreddit: string,
	author: string,
	permalink: string,
	createdUtc: number,
	body: string,
	title: string,
	url: string,
	score: number,
	tags: string[],
	savedAt: number,
	lastSeenAt: number,
|};

export const SAVED_CONTENT_DB_NAME = 'rsm-savedContent';
export const SAVED_CONTENT_STORE_NAME = 'accountItems';
export const SAVED_CONTENT_LEGACY_STORE_NAME = 'items';
export const SAVED_CONTENT_SCHEMA_VERSION = 2;
export const UNASSIGNED_SAVED_ACCOUNT = '<unassigned>';

function str(v: mixed): string { return typeof v === 'string' ? v : ''; }
function num(v: mixed): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function normalizeSavedUsername(value: mixed): string {
	if (typeof value !== 'string') return '';
	const match = /^(?:u\/)?([a-z0-9_-]{3,20})\/?$/i.exec(value.trim());
	return match ? match[1].toLowerCase() : '';
}

function requireSavedAccount(value: mixed): string {
	const username = normalizeSavedUsername(value);
	if (!username) throw new Error('A valid Reddit username is required for saved-content storage');
	return username;
}

export function parseSavedPage(raw: mixed): {| items: SavedItem[], after: ?string |} {
	if (!raw || typeof raw !== 'object') return { items: [], after: null };
	const data = (raw: any).data;
	if (!data || typeof data !== 'object') return { items: [], after: null };
	const items: SavedItem[] = [];
	const children = data.children;
	if (Array.isArray(children)) {
		for (const child of children) {
			if (!child || typeof child !== 'object') continue;
			const kind = (child: any).kind;
			const k = (child: any).data;
			if ((kind !== 't1' && kind !== 't3') || !k) continue;
			items.push({
				kind,
				fullname: str(k.name),
				id: str(k.id),
				subreddit: str(k.subreddit),
				author: str(k.author),
				permalink: str(k.permalink),
				createdUtc: num(k.created_utc),
				body: str(k.body) || str(k.selftext),
				title: str(k.title),
				url: str(k.url),
				score: num(k.score),
			});
		}
	}
	const after = typeof data.after === 'string' && data.after ? data.after : null;
	return { items, after };
}

export function buildSavedUrl(username: string, after: ?string, limit: number = 100): string {
	const user = encodeURIComponent(normalizeSavedUsername(username) || 'me');
	const u = new URL(`https://old.reddit.com/user/${user}/saved.json`);
	u.searchParams.set('limit', String(Math.max(1, Math.min(100, limit))));
	u.searchParams.set('raw_json', '1');
	if (after) u.searchParams.set('after', after);
	return u.toString();
}

export function mergeAndDedupe(existing: SavedItem[], next: SavedItem[]): SavedItem[] {
	const seen: Set<string> = new Set();
	const out: SavedItem[] = [];
	for (const list of [existing, next]) {
		for (const item of list) {
			if (!item.fullname || seen.has(item.fullname)) continue;
			seen.add(item.fullname);
			out.push(item);
		}
	}
	return out;
}

export function normalizeSavedTag(value: mixed): string {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/\s+/g, ' ').slice(0, 48);
}

export function normalizeSavedTags(raw: mixed): string[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const tags = [];
	for (const value of raw) {
		const tag = normalizeSavedTag(value);
		const key = tag.toLocaleLowerCase();
		if (!tag || seen.has(key)) continue;
		seen.add(key);
		tags.push(tag);
	}
	return tags.slice(0, 20);
}

export function normalizeSavedRecord(raw: mixed, fallbackUsername: mixed = UNASSIGNED_SAVED_ACCOUNT): ?SavedRecord {
	if (!raw || typeof raw !== 'object') return null;
	const item: any = raw;
	if ((item.kind !== 't1' && item.kind !== 't3') || typeof item.fullname !== 'string' || !item.fullname) return null;
	const fallback = fallbackUsername === UNASSIGNED_SAVED_ACCOUNT ?
		UNASSIGNED_SAVED_ACCOUNT : normalizeSavedUsername(fallbackUsername);
	const username = normalizeSavedUsername(item.username) || fallback;
	if (!username) return null;
	return {
		username,
		kind: item.kind,
		fullname: item.fullname,
		id: str(item.id),
		subreddit: str(item.subreddit),
		author: str(item.author),
		permalink: str(item.permalink),
		createdUtc: num(item.createdUtc),
		body: str(item.body),
		title: str(item.title),
		url: str(item.url),
		score: num(item.score),
		tags: normalizeSavedTags(item.tags),
		savedAt: num(item.savedAt),
		lastSeenAt: num(item.lastSeenAt),
	};
}

export function normalizeSavedRecords(raw: mixed, fallbackUsername: mixed = UNASSIGNED_SAVED_ACCOUNT): SavedRecord[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(item => normalizeSavedRecord(item, fallbackUsername)).filter(Boolean);
}

export function partitionSavedRecords(raw: mixed, username: mixed): SavedRecord[] {
	const account = username === UNASSIGNED_SAVED_ACCOUNT ?
		UNASSIGNED_SAVED_ACCOUNT : normalizeSavedUsername(username);
	if (!account) return [];
	return normalizeSavedRecords(raw).filter(record => record.username === account);
}

export function mergeSavedRecords(username: string, rawExisting: mixed, incoming: SavedItem[], now: number = Date.now()): SavedRecord[] {
	const account = requireSavedAccount(username);
	const byFullname = new Map<string, SavedRecord>();
	for (const existing of partitionSavedRecords(rawExisting, account)) byFullname.set(existing.fullname, existing);
	for (const item of incoming) {
		if (!item || !item.fullname) continue;
		const previous = byFullname.get(item.fullname);
		byFullname.set(item.fullname, {
			...item,
			username: account,
			tags: previous ? previous.tags : [],
			savedAt: previous && previous.savedAt ? previous.savedAt : now,
			lastSeenAt: now,
		});
	}
	return [...byFullname.values()].sort((a, b) => b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname));
}

export function filterSavedItems(items: SavedRecord[], username: mixed, query: mixed, tag: mixed = ''): SavedRecord[] {
	const needle = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
	const tagNeedle = normalizeSavedTag(tag).toLocaleLowerCase();
	return partitionSavedRecords(items, username).filter(item => {
		if (tagNeedle === '__untagged__' && item.tags.length) return false;
		if (tagNeedle && tagNeedle !== '__untagged__' && !item.tags.some(itemTag => itemTag.toLocaleLowerCase() === tagNeedle)) return false;
		if (!needle) return true;
		return [item.title, item.body, item.subreddit, item.author, item.permalink, item.tags.join(' ')]
			.join(' ').toLocaleLowerCase().includes(needle);
	});
}

export function listSavedTags(items: SavedRecord[], username: mixed): string[] {
	const tags = new Map<string, string>();
	for (const item of partitionSavedRecords(items, username)) {
		for (const tag of item.tags) tags.set(tag.toLocaleLowerCase(), tag);
	}
	return [...tags.values()].sort((a, b) => a.localeCompare(b));
}

function createSavedAccountStore(db: any): any {
	const store = db.createObjectStore(SAVED_CONTENT_STORE_NAME, { keyPath: ['username', 'fullname'] });
	store.createIndex('username', 'username', { unique: false });
	store.createIndex('usernameCreatedUtc', ['username', 'createdUtc'], { unique: false });
	return store;
}

function openSavedContentDatabase(): Promise<any> {
	if (!canPersistFeatureData('savedBackup')) return Promise.reject(new Error('Saved-content storage is unavailable in private browsing'));
	if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'));
	return new Promise((resolve, reject) => {
		try {
			const request = indexedDB.open(SAVED_CONTENT_DB_NAME, SAVED_CONTENT_SCHEMA_VERSION);
			request.onupgradeneeded = event => {
				const db = request.result;
				const transaction = request.transaction;
				const accountStore = db.objectStoreNames.contains(SAVED_CONTENT_STORE_NAME) ?
					transaction.objectStore(SAVED_CONTENT_STORE_NAME) : createSavedAccountStore(db);
				if (event.oldVersion < 2 && db.objectStoreNames.contains(SAVED_CONTENT_LEGACY_STORE_NAME)) {
					// Keep the v1 store byte-for-byte as the recovery copy. Ownership was
					// never recorded in v1, so every migrated row goes to an account name
					// that no Reddit user can have rather than the account that happens to
					// be signed in during the upgrade.
					const cursorRequest = transaction.objectStore(SAVED_CONTENT_LEGACY_STORE_NAME).openCursor();
					cursorRequest.onsuccess = () => {
						const cursor = cursorRequest.result;
						if (!cursor) return;
						const record = normalizeSavedRecord({
							...cursor.value,
							username: UNASSIGNED_SAVED_ACCOUNT,
						}, UNASSIGNED_SAVED_ACCOUNT);
						if (record) accountStore.put(record);
						cursor.continue();
					};
					cursorRequest.onerror = () => transaction.abort();
				}
			};
			request.onsuccess = () => {
				request.result.onversionchange = () => request.result.close();
				resolve(request.result);
			};
			request.onerror = () => reject(request.error || new Error('Could not open saved-content storage'));
		} catch (error) {
			reject(error);
		}
	});
}

export function loadSavedRecords(username: string): Promise<SavedRecord[]> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return Promise.resolve([]);
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const request = db.transaction(SAVED_CONTENT_STORE_NAME, 'readonly')
				.objectStore(SAVED_CONTENT_STORE_NAME).index('username').getAll(account);
			request.onsuccess = () => {
				db.close();
				resolve(partitionSavedRecords(request.result, account)
					.sort((a, b) => b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname)));
			};
			request.onerror = () => { db.close(); reject(request.error || new Error('Could not read saved-content storage')); };
		} catch (error) {
			db.close();
			reject(error);
		}
	}));
}

export function mergeSavedRecordsIntoStore(username: string, items: SavedItem[], now: number = Date.now()): Promise<SavedRecord[]> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return Promise.resolve(mergeSavedRecords(account, [], items, now));
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const transaction = db.transaction(SAVED_CONTENT_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(SAVED_CONTENT_STORE_NAME);
			const request = store.index('username').getAll(account);
			request.onsuccess = () => {
				const merged = mergeSavedRecords(account, request.result, items, now);
				const incomingIds = new Set(items.map(item => item.fullname));
				for (const record of merged) {
					if (incomingIds.has(record.fullname)) store.put(record);
				}
				transaction.oncomplete = () => { db.close(); resolve(merged); };
			};
			transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Could not write saved-content storage')); };
			request.onerror = () => { db.close(); reject(request.error || new Error('Could not read saved-content storage')); };
		} catch (error) {
			db.close();
			reject(error);
		}
	}));
}

export function updateSavedRecordTags(username: string, fullname: string, tags: string[]): Promise<?SavedRecord> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return Promise.resolve(null);
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const transaction = db.transaction(SAVED_CONTENT_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(SAVED_CONTENT_STORE_NAME);
			const request = store.get([account, fullname]);
			request.onsuccess = () => {
				const record = normalizeSavedRecord(request.result);
				if (!record) {
					transaction.oncomplete = () => { db.close(); resolve(null); };
					return;
				}
				const updated = { ...record, tags: normalizeSavedTags(tags) };
				store.put(updated);
				transaction.oncomplete = () => { db.close(); resolve(updated); };
			};
			transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Could not update saved-content tags')); };
			request.onerror = () => { db.close(); reject(request.error || new Error('Could not read saved-content item')); };
		} catch (error) {
			db.close();
			reject(error);
		}
	}));
}

export function purgeSavedRecords(username: string): Promise<number> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return Promise.resolve(0);
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const transaction = db.transaction(SAVED_CONTENT_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(SAVED_CONTENT_STORE_NAME);
			const request = store.index('username').getAll(account);
			let deleted = 0;
			request.onsuccess = () => {
				const scoped = partitionSavedRecords(request.result, account);
				deleted = scoped.length;
				for (const record of scoped) store.delete([account, record.fullname]);
			};
			transaction.oncomplete = () => { db.close(); resolve(deleted); };
			transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Could not purge saved content')); };
			request.onerror = () => { db.close(); reject(request.error || new Error('Could not read saved-content partition')); };
		} catch (error) {
			db.close();
			reject(error);
		}
	}));
}

export function buildExport(username: string, items: $ReadOnlyArray<SavedRecord>): SavedExport {
	const account = requireSavedAccount(username);
	const scoped = partitionSavedRecords(items, account);
	return {
		username: account,
		exportedAt: Date.now(),
		schemaVersion: SAVED_CONTENT_SCHEMA_VERSION,
		count: scoped.length,
		items: scoped,
	};
}
