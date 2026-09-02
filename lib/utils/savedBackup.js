/* @flow */
// Pure helpers for the savedBackup module. Normalises the paginated reddit
// listing response and shapes the export payload. Persistent operations consult
// the foreground private-context policy before touching the store.

import { canPersistFeatureData } from '../environment';
import { readRecords, writeRecords } from '../environment/foreground/featureDb';
import { UNASSIGNED_SAVED_ACCOUNT } from './featureStores';

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

export const SAVED_CONTENT_SCHEMA_VERSION = 2;
export { UNASSIGNED_SAVED_ACCOUNT };

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

// One account's records. The store keys on `[username, fullname]`, so the
// account index is what scopes a read to the signed-in user; every caller here
// goes through it rather than filtering a whole-store read in memory.
export async function loadSavedRecords(username: string): Promise<SavedRecord[]> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return [];
	const stored = await readRecords('savedContent', 'username', account);
	return partitionSavedRecords(stored, account)
		.sort((a, b) => b.createdUtc - a.createdUtc || a.fullname.localeCompare(b.fullname));
}

export async function mergeSavedRecordsIntoStore(username: string, items: SavedItem[], now: number = Date.now()): Promise<SavedRecord[]> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return mergeSavedRecords(account, [], items, now);
	const stored = await readRecords('savedContent', 'username', account);
	const merged = mergeSavedRecords(account, stored, items, now);
	const incoming = new Set(items.map(item => item.fullname));
	await writeRecords('savedContent', merged.filter(record => incoming.has(record.fullname)));
	return merged;
}

export async function updateSavedRecordTags(username: string, fullname: string, tags: string[]): Promise<?SavedRecord> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return null;
	const stored = await readRecords('savedContent', 'username', account);
	const record = partitionSavedRecords(stored, account).find(item => item.fullname === fullname);
	if (!record) return null;
	const updated = { ...record, tags: normalizeSavedTags(tags) };
	await writeRecords('savedContent', [updated]);
	return updated;
}

export async function purgeSavedRecords(username: string): Promise<number> {
	const account = requireSavedAccount(username);
	if (!canPersistFeatureData('savedBackup')) return 0;
	const stored = await readRecords('savedContent', 'username', account);
	const scoped = partitionSavedRecords(stored, account);
	await writeRecords('savedContent', [], scoped.map(record => [account, record.fullname]));
	return scoped.length;
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
