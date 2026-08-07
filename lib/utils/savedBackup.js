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
	items: SavedItem[],
|};

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

export function buildExport(username: string, items: $ReadOnlyArray<SavedItem>): SavedExport {
	return {
		username,
		exportedAt: Date.now(),
		schemaVersion: 1,
		count: items.length,
		items: items.slice(),
	};
}
