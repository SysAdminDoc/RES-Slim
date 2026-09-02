/* @flow */
// Pure helpers for the userTagger module. Dependency-free so they can be
// unit-tested without the extension runtime.

export type UserTag = {|
	tag: string, // free-text label, may be empty when only colorising
	color: string, // hex string like '#5b8def' or '' for default
	ignore: boolean, // hide all posts/comments by this user
	ts: number, // creation/update timestamp (ms)
|};

export type UserTagMap = { [username: string]: UserTag };

export type TagImportConflictMode = 'keep' | 'replace';

export type TagImportPreview = {|
	incoming: UserTagMap,
	counts: {|
		valid: number,
		invalid: number,
		newRecords: number,
		conflicting: number,
	|},
	error: ?string,
|};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TAG_LEN = 120;

// Tags are stored in a plain object keyed by username, and reddit allows names
// that are also members of Object.prototype. `__proto__` is the dangerous one:
// assigning to it on an object literal sets the prototype instead of adding an
// entry, so importing a tag for that "user" would have rewritten every object in
// the page. `constructor` and `prototype` are refused with it - a tag for one of
// them was never readable back through a plain member read anyway.
const RESERVED_USERNAMES = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeUsername(input: mixed): string {
	if (typeof input !== 'string') return '';
	const normalized = input.trim().toLowerCase();
	return RESERVED_USERNAMES.has(normalized) ? '' : normalized;
}

export function sanitizeTagText(input: mixed): string {
	if (typeof input !== 'string') return '';
	// Strip control chars (replace with space so whitespace separators survive
	// the collapse), then collapse runs of whitespace, then trim and cap length.
	const cleaned = input.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
	return cleaned.slice(0, MAX_TAG_LEN);
}

export function sanitizeColor(input: mixed): string {
	if (typeof input !== 'string') return '';
	const trimmed = input.trim();
	if (!trimmed) return '';
	return HEX_RE.test(trimmed) ? trimmed.toLowerCase() : '';
}

export function normalizeTag(raw: mixed): UserTag | null {
	if (!raw || typeof raw !== 'object') return null;
	const r: any = raw;
	const tag = sanitizeTagText(r.tag);
	const color = sanitizeColor(r.color);
	const ignore = r.ignore === true;
	// A tag entry must carry SOME signal to be worth persisting.
	if (!tag && !color && !ignore) return null;
	const tsRaw = Number(r.ts);
	const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : Date.now();
	return { tag, color, ignore, ts };
}

export function normalizeTagMap(raw: mixed): UserTagMap {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: UserTagMap = {};
	for (const key of Object.keys(raw)) {
		const username = normalizeUsername(key);
		const tag = normalizeTag((raw: any)[key]);
		if (username && tag) out[username] = tag;
	}
	return out;
}

function emptyImportPreview(error: ?string, invalid: number = 0): TagImportPreview {
	return {
		incoming: {},
		counts: { valid: 0, invalid, newRecords: 0, conflicting: 0 },
		error,
	};
}

export function inspectTagImport(raw: mixed, base: UserTagMap): TagImportPreview {
	if (typeof raw !== 'string' || !raw.trim()) {
		return emptyImportPreview('Paste a JSON object before previewing the import.');
	}

	let parsed: mixed;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return emptyImportPreview('The import payload is not valid JSON.', 1);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return emptyImportPreview('The import payload must be a JSON object keyed by username.', 1);
	}

	const existing = normalizeTagMap(base);
	const incoming: UserTagMap = {};
	let invalid = 0;
	for (const key of Object.keys(parsed)) {
		const username = normalizeUsername(key);
		const tag = normalizeTag((parsed: any)[key]);
		if (!username || !tag || Object.hasOwn(incoming, username)) {
			invalid += 1;
			continue;
		}
		incoming[username] = tag;
	}

	const usernames = Object.keys(incoming);
	const conflicting = usernames.filter(username => Object.hasOwn(existing, username)).length;
	return {
		incoming,
		counts: {
			valid: usernames.length,
			invalid,
			newRecords: usernames.length - conflicting,
			conflicting,
		},
		error: null,
	};
}

export function parseTagsJson(raw: mixed): UserTagMap {
	return inspectTagImport(raw, {}).incoming;
}

export function stringifyTags(map: UserTagMap): string {
	// Stable key order to make backups diff-friendly.
	const keys = Object.keys(map).sort();
	const ordered: UserTagMap = {};
	for (const k of keys) ordered[k] = map[k];
	return JSON.stringify(ordered, null, 2);
}

export function mergeTags(base: UserTagMap, incoming: UserTagMap): UserTagMap {
	// Right-wins on key collisions, but never resurrects a deleted (null/undefined) entry.
	const out: UserTagMap = { ...base };
	for (const k of Object.keys(incoming)) {
		const v = incoming[k];
		if (v) out[k] = v;
	}
	return out;
}

export function buildTagImportMap(
	base: UserTagMap,
	incoming: UserTagMap,
	conflictMode: TagImportConflictMode = 'keep',
): UserTagMap {
	const current = normalizeTagMap(base);
	const candidate = normalizeTagMap(incoming);
	return conflictMode === 'replace' ? mergeTags(current, candidate) : mergeTags(candidate, current);
}

type TagImportTransaction = {|
	original: UserTagMap,
	next: UserTagMap,
	saveRollback: (snapshot: UserTagMap) => Promise<void>,
	writeMap: (value: UserTagMap) => Promise<void>,
	readMap: () => Promise<mixed>,
	clearPayload: () => Promise<void>,
|};

function normalizeError(error: mixed): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export async function commitTagImport(transaction: TagImportTransaction): Promise<UserTagMap> {
	const original = normalizeTagMap(transaction.original);
	const next = normalizeTagMap(transaction.next);
	await transaction.saveRollback(original);

	try {
		await transaction.writeMap(next);
		const committed = normalizeTagMap(await transaction.readMap());
		if (stringifyTags(committed) !== stringifyTags(next)) {
			throw new Error('The committed tag map did not match the import plan.');
		}
		await transaction.clearPayload();
		return committed;
	} catch (error) {
		const failure = normalizeError(error);
		try {
			await transaction.writeMap(original);
		} catch (rollbackError) {
			failure.message = `${failure.message} Restoring the pre-import tag map also failed: ${normalizeError(rollbackError).message}`;
			(failure: any).cause = rollbackError;
		}
		throw failure;
	}
}

export function tagBadgeText(tag: UserTag): string {
	if (tag.tag) return tag.tag;
	if (tag.ignore) return 'ignored';
	return '';
}
