/* @flow */
// Pure helpers for the waybackSnapshot module. Builds the Wayback save and
// availability URLs, normalises the response, and recognises archive URLs.
// Dependency-free for unit testing.

export type WaybackSnapshot = {|
	url: string,
	timestamp: string,
	available: boolean,
|};

export const SAVE_BASE = 'https://web.archive.org/save/';
export const AVAILABILITY_BASE = 'https://archive.org/wayback/available';

export function buildSaveUrl(targetUrl: string): string {
	if (typeof targetUrl !== 'string' || !targetUrl) return SAVE_BASE;
	return `${SAVE_BASE}${targetUrl}`;
}

export function buildAvailabilityUrl(targetUrl: string): string {
	if (typeof targetUrl !== 'string' || !targetUrl) return AVAILABILITY_BASE;
	const u = new URL(AVAILABILITY_BASE);
	u.searchParams.set('url', targetUrl);
	return u.toString();
}

export function parseAvailabilityResponse(raw: mixed): ?WaybackSnapshot {
	if (!raw || typeof raw !== 'object') return null;
	const r: any = raw;
	const snap = r.archived_snapshots && r.archived_snapshots.closest;
	if (!snap || typeof snap !== 'object') return null;
	const url = typeof snap.url === 'string' ? snap.url : '';
	if (!url) return null;
	return {
		url,
		timestamp: typeof snap.timestamp === 'string' ? snap.timestamp : '',
		available: snap.available === true,
	};
}

export function isWaybackUrl(url: mixed): boolean {
	return typeof url === 'string' && /^https?:\/\/web\.archive\.org\/web\//i.test(url);
}

const TS_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function formatTimestamp(ts: mixed): string {
	if (typeof ts !== 'string') return '';
	const m = TS_RE.exec(ts);
	if (!m) return ts;
	return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]} UTC`;
}
