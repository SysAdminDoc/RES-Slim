/* @flow */
// Pure helpers for the waybackSnapshot module. Builds the Wayback save and
// availability URLs, normalises CDX responses, and recognises archive URLs.
// Dependency-free for unit testing.

export type WaybackSnapshot = {|
	url: string,
	timestamp: string,
	available: boolean,
|};

export const SAVE_BASE = 'https://web.archive.org/save/';
export const AVAILABILITY_BASE = 'https://web.archive.org/cdx/search/cdx';

const TS_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function buildSaveUrl(targetUrl: string): string {
	if (typeof targetUrl !== 'string' || !targetUrl) return SAVE_BASE;
	return `${SAVE_BASE}${targetUrl}`;
}

export function buildAvailabilityUrl(targetUrl: string): string {
	if (typeof targetUrl !== 'string' || !targetUrl) return AVAILABILITY_BASE;
	const u = new URL(AVAILABILITY_BASE);
	u.searchParams.set('url', targetUrl);
	u.searchParams.set('output', 'json');
	u.searchParams.set('filter', 'statuscode:200');
	u.searchParams.set('fl', 'timestamp,original');
	u.searchParams.set('limit', '-1');
	return u.toString();
}

export function parseAvailabilityResponse(raw: mixed): ?WaybackSnapshot {
	if (!Array.isArray(raw) || raw.length < 2) return null;
	const row: any = raw[raw.length - 1];
	if (!Array.isArray(row)) return null;
	const timestamp = typeof row[0] === 'string' ? row[0] : '';
	const original = typeof row[1] === 'string' ? row[1] : '';
	if (!TS_RE.test(timestamp) || !/^https?:\/\//i.test(original)) return null;
	return {
		url: `https://web.archive.org/web/${timestamp}/${original}`,
		timestamp,
		available: true,
	};
}

// Three outcomes, not two.
//
// `waybackSnapshot` used to collapse every failure into `null`, so a 502, a
// dropped connection, a body the parser could not read and a genuine "this URL
// was never archived" were the same value — and the caller acted on the last
// reading, opening Save Page Now for a URL that may already be archived and then
// reporting success. Observed live on 2026-08-18: archive.org answered 200 and
// the Wayback machine itself 302 while `/wayback/available` returned 502 for
// minutes, during which the module quietly claimed nothing on the page was
// archived.
//
// Same defect `viewDeleted` had in v0.36.0, where a 429 read as "not archived",
// and the same fix: name the outcomes.
export type AvailabilityResult =
	| {| state: 'available', url: string, timestamp: string, isStale: boolean |}
	| {| state: 'absent' |}
	| {| state: 'unavailable', reason: string |};

// The CDX API returns a header-only array when it has no matching capture. That
// is an answer, and a different one from no answer at all.
function isWellFormedAvailability(raw: mixed): boolean {
	if (!Array.isArray(raw) || raw.length !== 1 || !Array.isArray(raw[0])) return false;
	const header: any = raw[0];
	return header[0] === 'timestamp' && header[1] === 'original';
}

export function classifyAvailability(raw: mixed, now: number, staleAfterMs: number): AvailabilityResult {
	const parsed = parseAvailabilityResponse(raw);
	if (!parsed) {
		return isWellFormedAvailability(raw) ?
			{ state: 'absent' } :
			{ state: 'unavailable', reason: 'unreadable response' };
	}
	if (!parsed.available) return { state: 'absent' };
	const when = timestampToDate(parsed.timestamp);
	const stale = !when || (now - when.getTime() > staleAfterMs);
	return { state: 'available', url: parsed.url, timestamp: parsed.timestamp, isStale: stale };
}

export function timestampToDate(ts: string): ?Date {
	const m = TS_RE.exec(ts);
	if (!m) return null;
	const [, y, mo, d, h, mi, sec] = m;
	return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
}

export function isWaybackUrl(url: mixed): boolean {
	return typeof url === 'string' && /^https?:\/\/web\.archive\.org\/web\//i.test(url);
}

export function formatTimestamp(ts: mixed): string {
	if (typeof ts !== 'string') return '';
	const m = TS_RE.exec(ts);
	if (!m) return ts;
	return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]} UTC`;
}
