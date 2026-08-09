/* @flow */
// Pure helpers for the savedBackup module. Normalises the paginated reddit
// listing response and shapes the export payload. Dependency-free for unit
// testing.

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
	items: Array<SavedItem | SavedRecord>,
|};


export type SavedRecord = {|
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
export const SAVED_CONTENT_STORE_NAME = 'items';
export const SAVED_CONTENT_SCHEMA_VERSION = 1;

function str(v: mixed): string { return typeof v === 'string' ? v : ''; }
function num(v: mixed): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

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
	const user = encodeURIComponent(username || 'me');
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

export function normalizeSavedRecord(raw: mixed): ?SavedRecord {
	if (!raw || typeof raw !== 'object') return null;
	const item: any = raw;
	if ((item.kind !== 't1' && item.kind !== 't3') || typeof item.fullname !== 'string' || !item.fullname) return null;
	return {
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

export function normalizeSavedRecords(raw: mixed): SavedRecord[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(normalizeSavedRecord).filter(Boolean);
}

export function mergeSavedRecords(rawExisting: mixed, incoming: SavedItem[], now: number = Date.now()): SavedRecord[] {
	const byFullname = new Map<string, SavedRecord>();
	for (const existing of normalizeSavedRecords(rawExisting)) byFullname.set(existing.fullname, existing);
	for (const item of incoming) {
		if (!item || !item.fullname) continue;
		const previous = byFullname.get(item.fullname);
		byFullname.set(item.fullname, {
			...item,
			tags: previous ? previous.tags : [],
			savedAt: previous && previous.savedAt ? previous.savedAt : now,
			lastSeenAt: now,
		});
	}
	return [...byFullname.values()].sort((a, b) => b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname));
}

export function filterSavedItems(items: SavedRecord[], query: mixed, tag: mixed = ''): SavedRecord[] {
	const needle = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
	const tagNeedle = normalizeSavedTag(tag).toLocaleLowerCase();
	return items.filter(item => {
		if (tagNeedle === '__untagged__' && item.tags.length) return false;
		if (tagNeedle && tagNeedle !== '__untagged__' && !item.tags.some(itemTag => itemTag.toLocaleLowerCase() === tagNeedle)) return false;
		if (!needle) return true;
		return [item.title, item.body, item.subreddit, item.author, item.permalink, item.tags.join(' ')]
			.join(' ').toLocaleLowerCase().includes(needle);
	});
}

export function listSavedTags(items: SavedRecord[]): string[] {
	const tags = new Map<string, string>();
	for (const item of items) {
		for (const tag of item.tags) tags.set(tag.toLocaleLowerCase(), tag);
	}
	return [...tags.values()].sort((a, b) => a.localeCompare(b));
}

function openSavedContentDatabase(): Promise<any> {
	if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'));
	return new Promise((resolve, reject) => {
		try {
			const request = indexedDB.open(SAVED_CONTENT_DB_NAME, SAVED_CONTENT_SCHEMA_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(SAVED_CONTENT_STORE_NAME)) {
					const store = db.createObjectStore(SAVED_CONTENT_STORE_NAME, { keyPath: 'fullname' });
					store.createIndex('createdUtc', 'createdUtc', { unique: false });
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

export function loadSavedRecords(): Promise<SavedRecord[]> {
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const request = db.transaction(SAVED_CONTENT_STORE_NAME, 'readonly').objectStore(SAVED_CONTENT_STORE_NAME).getAll();
			request.onsuccess = () => { db.close(); resolve(normalizeSavedRecords(request.result)); };
			request.onerror = () => { db.close(); reject(request.error || new Error('Could not read saved-content storage')); };
		} catch (error) {
			db.close();
			reject(error);
		}
	}));
}

export function mergeSavedRecordsIntoStore(items: SavedItem[], now: number = Date.now()): Promise<SavedRecord[]> {
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const transaction = db.transaction(SAVED_CONTENT_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(SAVED_CONTENT_STORE_NAME);
			const request = store.getAll();
			request.onsuccess = () => {
				const merged = mergeSavedRecords(request.result, items, now);
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

export function updateSavedRecordTags(fullname: string, tags: string[]): Promise<?SavedRecord> {
	return openSavedContentDatabase().then(db => new Promise((resolve, reject) => {
		try {
			const transaction = db.transaction(SAVED_CONTENT_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(SAVED_CONTENT_STORE_NAME);
			const request = store.get(fullname);
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

export function buildExport(username: string, items: $ReadOnlyArray<SavedItem | SavedRecord>): SavedExport {
	return {
		username,
		exportedAt: Date.now(),
		schemaVersion: 1,
		count: items.length,
		items: items.slice(),
	};
}
