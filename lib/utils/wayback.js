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

const TS_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

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

// `{"archived_snapshots":{}}` is how the API says "nothing archived". That is an
// answer, and a different one from no answer at all — which is the whole
// distinction this function exists to preserve, so the two are told apart before
// the parser's `null` can flatten them back together.
function isWellFormedAvailability(raw: mixed): boolean {
	return !!raw && typeof raw === 'object' && !Array.isArray(raw) &&
		typeof (raw: any).archived_snapshots === 'object' && (raw: any).archived_snapshots !== null;
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
