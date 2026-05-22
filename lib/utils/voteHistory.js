/* @flow */
// Pure helpers for the voteHistory module. Models vote-event records and the
// IndexedDB schema, plus utility functions for filtering and exporting.
// Dependency-free for unit testing — the actual IDB plumbing lives in the
// module file.

export type VoteDirection = 'up' | 'down' | 'unvote';

export type VoteRecord = {|
	id: string,                 // primary key: `${fullname}@${timestamp}`
	fullname: string,           // t1_xxx or t3_xxx
	kind: 't1' | 't3',
	direction: VoteDirection,
	subreddit: string,
	author: string,
	permalink: string,
	snippet: string,            // up to 240 chars of the body
	scoreAtTime: number,
	timestamp: number,          // ms
|};

export const SCHEMA_VERSION = 1;
export const DB_NAME = 'rsm-voteHistory';
export const STORE_NAME = 'votes';

const SNIPPET_LIMIT = 240;

function str(v: mixed): string { return typeof v === 'string' ? v : ''; }
function num(v: mixed): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function makeId(fullname: string, timestamp: number): string {
	return `${fullname}@${Math.floor(timestamp)}`;
}

export function classifyDirection(raw: mixed): ?VoteDirection {
	if (raw === 1 || raw === '1' || raw === 'up' || raw === true) return 'up';
	if (raw === -1 || raw === '-1' || raw === 'down') return 'down';
	if (raw === 0 || raw === '0' || raw === 'unvote' || raw === null) return 'unvote';
	return null;
}

export function buildRecord(input: {|
	fullname: string,
	direction: VoteDirection,
	subreddit: mixed,
	author: mixed,
	permalink: mixed,
	body: mixed,
	scoreAtTime: mixed,
	now?: number,
|}): ?VoteRecord {
	const fullname = str(input.fullname);
	if (!fullname) return null;
	const kind = fullname.startsWith('t3_') ? 't3' : fullname.startsWith('t1_') ? 't1' : null;
	if (!kind) return null;
	const now = typeof input.now === 'number' ? input.now : Date.now();
	const snippet = str(input.body).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMIT);
	return {
		id: makeId(fullname, now),
		fullname,
		kind,
		direction: input.direction,
		subreddit: str(input.subreddit),
		author: str(input.author),
		permalink: str(input.permalink),
		snippet,
		scoreAtTime: num(input.scoreAtTime),
		timestamp: now,
	};
}

export function filterRecords(records: $ReadOnlyArray<VoteRecord>, opts: {|
	subreddit?: ?string,
	author?: ?string,
	direction?: ?VoteDirection,
	since?: ?number,
	until?: ?number,
|}): VoteRecord[] {
	return records.filter(r => {
		if (opts.subreddit && r.subreddit.toLowerCase() !== opts.subreddit.toLowerCase()) return false;
		if (opts.author && r.author.toLowerCase() !== opts.author.toLowerCase()) return false;
		if (opts.direction && r.direction !== opts.direction) return false;
		if (typeof opts.since === 'number' && r.timestamp < opts.since) return false;
		if (typeof opts.until === 'number' && r.timestamp > opts.until) return false;
		return true;
	});
}

export function toCsv(records: $ReadOnlyArray<VoteRecord>): string {
	const header = ['timestamp', 'direction', 'fullname', 'kind', 'subreddit', 'author', 'permalink', 'scoreAtTime', 'snippet'];
	const escape = (val: mixed) => {
		const s = String(val == null ? '' : val);
		if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
		return s;
	};
	const lines = [header.join(',')];
	for (const r of records) {
		lines.push([
			new Date(r.timestamp).toISOString(),
			r.direction,
			r.fullname,
			r.kind,
			r.subreddit,
			r.author,
			r.permalink,
			String(r.scoreAtTime),
			r.snippet,
		].map(escape).join(','));
	}
	return lines.join('\n');
}
