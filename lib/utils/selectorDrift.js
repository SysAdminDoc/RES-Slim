/* @flow */
// The structured record behind the selector-drift view.
//
// Drift already reached the module error log, which is where it stopped being
// useful: one line among everything else that ever went wrong, in a textarea the
// user has to go looking for. Old Reddit's markup is the thing this fork stands
// on, and reddit has said it is weighing access limits and rebuilding on a
// modern foundation, so "which surfaces are drifting, on which kinds of page,
// since when" is a question worth being able to answer at a glance.
//
// Kept deliberately narrow: page *kind*, surface names, and a date. Not the URL,
// not the subreddit, not a count of visits — the extension collects nothing, and
// a diagnostics record is exactly the sort of place that quietly stops being
// true.

// Structurally the same as `SurfaceMatch` in `lib/core/dom/selectors`, declared
// here rather than imported: `lib/utils` is not allowed to reach into
// `lib/core`, and a type-only import is still an import as far as that rule —
// and as far as the dependency direction it protects — is concerned.
export type SurfaceMatchLike = {
	+surfaceName: string,
	+status: string,
	+selector: ?string,
};

export type DriftFinding = {|
	surfaceName: string,
	status: 'fallback' | 'missing',
	selector: ?string,
|};

export type DriftRecord = {|
	pageType: string,
	firstSeen: number,
	lastSeen: number,
	findings: DriftFinding[],
|};

export type DriftState = { [pageType: string]: DriftRecord };

export const DRIFT_STORAGE_KEY = 'RES.selectorDrift';

function isFiniteTimestamp(value: mixed): boolean {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeFinding(raw: mixed): ?DriftFinding {
	if (!raw || typeof raw !== 'object') return null;
	const candidate: any = raw;
	if (typeof candidate.surfaceName !== 'string' || !candidate.surfaceName) return null;
	if (candidate.status !== 'fallback' && candidate.status !== 'missing') return null;
	return {
		surfaceName: candidate.surfaceName,
		status: candidate.status,
		selector: typeof candidate.selector === 'string' ? candidate.selector : null,
	};
}

export function normalizeDriftState(raw: mixed): DriftState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: DriftState = {};
	for (const [pageType, value] of Object.entries((raw: any))) {
		if (!pageType || typeof value !== 'object' || !value) continue;
		const record: any = value;
		if (!isFiniteTimestamp(record.firstSeen) || !isFiniteTimestamp(record.lastSeen)) continue;
		const findings = Array.isArray(record.findings) ?
			record.findings.map(normalizeFinding).filter(Boolean) : [];
		if (!findings.length) continue;
		out[pageType] = {
			pageType,
			firstSeen: Math.trunc(record.firstSeen),
			lastSeen: Math.trunc(record.lastSeen),
			findings,
		};
	}
	return out;
}

export function toFindings(matches: $ReadOnlyArray<SurfaceMatchLike>): DriftFinding[] {
	return matches
		.filter(match => match.status === 'fallback' || match.status === 'missing')
		.map(match => ({
			surfaceName: match.surfaceName,
			status: (match.status: any),
			selector: match.selector || null,
		}))
		.sort((a, b) => a.surfaceName.localeCompare(b.surfaceName));
}

function sameFindings(a: $ReadOnlyArray<DriftFinding>, b: $ReadOnlyArray<DriftFinding>): boolean {
	if (a.length !== b.length) return false;
	return a.every((finding, i) => finding.surfaceName === b[i].surfaceName &&
		finding.status === b[i].status && finding.selector === b[i].selector);
}

// `firstSeen` is what makes the record worth keeping: "listingFeed has been on a
// fallback since Tuesday" is a different situation from "since ten seconds ago",
// and only one of them is worth acting on. It survives every re-observation of
// the same drift and resets only when the drift itself changes.
export function mergeDrift(state: DriftState, pageType: string, findings: $ReadOnlyArray<DriftFinding>, now: number): DriftState {
	if (!pageType || !findings.length) return state;
	const previous = state[pageType];
	const firstSeen = previous && sameFindings(previous.findings, findings) ? previous.firstSeen : now;
	return {
		...state,
		[pageType]: { pageType, firstSeen, lastSeen: now, findings: [...findings] },
	};
}

export function clearDriftFor(state: DriftState, pageType: string): DriftState {
	if (!state[pageType]) return state;
	const next = { ...state };
	delete next[pageType];
	return next;
}

export function driftRecords(state: DriftState): DriftRecord[] {
	return Object.keys(state)
		.map(pageType => state[pageType])
		.sort((a, b) => b.lastSeen - a.lastSeen);
}

export function countDriftedSurfaces(state: DriftState): number {
	return driftRecords(state).reduce((total, record) => total + record.findings.length, 0);
}

export function describeFinding(finding: DriftFinding): string {
	return finding.status === 'fallback' ?
		`${finding.surfaceName} — matched fallback selector ${finding.selector || '(unknown)'}` :
		`${finding.surfaceName} — not found`;
}

function isoDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

// A report meant to be pasted into an issue: plain text, no timestamps finer
// than the day, and nothing in it that identifies the user or where they were.
export function formatDriftReport(state: DriftState, version: string = ''): string {
	const records = driftRecords(state);
	if (!records.length) return '';
	const lines = [`RES-Slim selector drift report${version ? ` (v${version})` : ''}`, ''];
	for (const record of records) {
		lines.push(`${record.pageType} — first seen ${isoDay(record.firstSeen)}, last seen ${isoDay(record.lastSeen)}`);
		for (const finding of record.findings) lines.push(`  - ${describeFinding(finding)}`);
		lines.push('');
	}
	lines.push('No URLs, subreddits or account details are included in this report.');
	return lines.join('\n');
}
