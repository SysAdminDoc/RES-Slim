/* @flow */
// Pure helpers for the crosspostMap module. Extracts the article ID from a
// permalink and normalises the /duplicates/<id>.json response. Dependency-free
// so it can be unit-tested without DOM/network.

export type Duplicate = {|
	id: string,
	subreddit: string,
	author: string,
	score: number,
	numComments: number,
	createdUtc: number,
	permalink: string,
	url: string,
|};

const ID_RE = /\/comments\/([a-z0-9]+)/i;

export function extractArticleId(pathname: string): string {
	if (typeof pathname !== 'string') return '';
	const m = ID_RE.exec(pathname);
	return m ? m[1].toLowerCase() : '';
}

export function buildDuplicatesUrl(articleId: string): string {
	const id = (articleId || '').replace(/[^a-z0-9]/gi, '');
	return `https://old.reddit.com/duplicates/${id}/.json?limit=50`;
}

function num(v: mixed, fallback: number = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function str(v: mixed): string {
	return typeof v === 'string' ? v : '';
}

export function parseDuplicatesResponse(raw: mixed, selfFullname: string): Duplicate[] {
	if (!Array.isArray(raw) || raw.length < 2) return [];
	const listing = raw[1];
	if (!listing || typeof listing !== 'object') return [];
	const data = (listing: any).data;
	if (!data || !Array.isArray(data.children)) return [];
	const me = (selfFullname || '').toLowerCase();
	const out: Duplicate[] = [];
	for (const child of data.children) {
		if (!child || typeof child !== 'object') continue;
		const k: any = (child: any).data;
		if (!k) continue;
		const fullname = str(k.name).toLowerCase();
		if (fullname && fullname === me) continue; // skip the original post itself
		out.push({
			id: str(k.id),
			subreddit: str(k.subreddit),
			author: str(k.author),
			score: num(k.score),
			numComments: num(k.num_comments),
			createdUtc: num(k.created_utc),
			permalink: str(k.permalink),
			url: str(k.url),
		});
	}
	// Most recent first.
	out.sort((a, b) => b.createdUtc - a.createdUtc);
	return out;
}

const MIN = 60;
const HOUR = 60 * 60;
const DAY = 60 * 60 * 24;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

export function relativeAge(createdUtc: number, nowMs: number = Date.now()): string {
	const ageSeconds = Math.max(0, nowMs / 1000 - createdUtc);
	if (ageSeconds < MIN) return 'just now';
	if (ageSeconds < HOUR) return `${Math.floor(ageSeconds / MIN)}m ago`;
	if (ageSeconds < DAY) return `${Math.floor(ageSeconds / HOUR)}h ago`;
	if (ageSeconds < MONTH) return `${Math.floor(ageSeconds / DAY)}d ago`;
	if (ageSeconds < YEAR) return `${Math.floor(ageSeconds / MONTH)}mo ago`;
	return `${Math.floor(ageSeconds / YEAR)}y ago`;
}
