/* @flow */
// Pure helpers for the arcticShift module. Builds API URLs, parses comment
// responses, and exposes the canonical instance host so the module can be
// pointed at a self-hosted Arctic Shift mirror. Dependency-free for unit
// testing.

export type ArcticComment = {|
	id: string,
	author: string,
	body: string,
	createdUtc: number,
|};

export type ArcticPost = {|
	id: string,
	author: string,
	title: string,
	selftext: string,
	url: string,
	createdUtc: number,
|};

export const DEFAULT_INSTANCE = 'https://arctic-shift.photon-reddit.com';

export function sanitizeInstance(raw: mixed, fallback: string = DEFAULT_INSTANCE): string {
	if (typeof raw !== 'string' || !raw.trim()) return fallback;
	let v = raw.trim();
	if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(v)) v = `https://${v}`;
	let url;
	try {
		url = new URL(v);
	} catch (err) {
		return fallback;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
	if (!url.hostname) return fallback;
	url.username = '';
	url.password = '';
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/+$/, '') || fallback;
}

export function parseAutoLoadBudget(raw: mixed, fallback: number = 25): number {
	const parsed = parseInt(String(raw == null ? '' : raw).trim(), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(0, parsed);
}

export function buildCommentUrl(instance: string, id: string): string {
	const i = sanitizeInstance(instance);
	const cleanId = String(id).replace(/^t1_/, '').replace(/[^a-z0-9]/gi, '');
	return `${i}/api/comments/ids?ids=${cleanId}`;
}

export function buildPostUrl(instance: string, id: string): string {
	const i = sanitizeInstance(instance);
	const cleanId = String(id).replace(/^t3_/, '').replace(/[^a-z0-9]/gi, '');
	return `${i}/api/posts/ids?ids=${cleanId}`;
}

function num(v: mixed, fallback: number = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function str(v: mixed): string {
	return typeof v === 'string' ? v : '';
}

export function parseCommentResponse(raw: mixed): ?ArcticComment {
	if (!raw || typeof raw !== 'object') return null;
	const r: any = raw;
	const list = r.data || r.results || r;
	if (!Array.isArray(list) || !list.length) return null;
	const item = list[0];
	if (!item || typeof item !== 'object') return null;
	const body = str(item.body);
	if (!body) return null;
	return {
		id: str(item.id),
		author: str(item.author) || 'unknown',
		body,
		createdUtc: num(item.created_utc),
	};
}

export function parsePostResponse(raw: mixed): ?ArcticPost {
	if (!raw || typeof raw !== 'object') return null;
	const r: any = raw;
	const list = r.data || r.results || r;
	if (!Array.isArray(list) || !list.length) return null;
	const item = list[0];
	if (!item || typeof item !== 'object') return null;
	return {
		id: str(item.id),
		author: str(item.author) || 'unknown',
		title: str(item.title),
		selftext: str(item.selftext),
		url: str(item.url),
		createdUtc: num(item.created_utc),
	};
}

export function isDeletedBody(text: mixed): boolean {
	if (typeof text !== 'string') return false;
	const t = text.trim();
	return t === '[removed]' || t === '[deleted]';
}
