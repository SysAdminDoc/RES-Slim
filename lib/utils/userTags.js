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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TAG_LEN = 120;

export function normalizeUsername(input: mixed): string {
	if (typeof input !== 'string') return '';
	return input.trim().toLowerCase();
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

export function parseTagsJson(raw: mixed): UserTagMap {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	let parsed: mixed;
	try { parsed = JSON.parse(raw); } catch (e) { return {}; }
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
	const out: UserTagMap = {};
	for (const k of Object.keys(parsed)) {
		const username = normalizeUsername(k);
		if (!username) continue;
		const norm = normalizeTag((parsed: any)[k]);
		if (norm) out[username] = norm;
	}
	return out;
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

export function tagBadgeText(tag: UserTag): string {
	if (tag.tag) return tag.tag;
	if (tag.ignore) return 'ignored';
	return '';
}
