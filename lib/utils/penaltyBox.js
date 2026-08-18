/* @flow */
// Failure backoff for media hosts.
//
// RES-Slim ships 74 media host handlers and had no shared failure policy: every
// one of them is tried on every matching link, and `linkScanner`'s catch logged
// to the console, destroyed the expando and moved on with no memory that it had
// just done the same thing for the previous twenty links. A host that is down
// therefore costs a network round-trip per link, per page, forever.
//
// Upstream ships a module called `penaltyBox`, and the roadmap proposed porting
// it. It is a different thing entirely — it lengthens hover-menu delays and
// eventually turns off the daily-tip feature when a user keeps dismissing it,
// and its only three callers (`RESTips`, `multiredditNavbar`,
// `profileNavigator`) are modules this fork does not ship. There was nothing to
// copy, so this is written for the problem the roadmap actually described.
//
// Deliberately pure: the state is a plain JSON-serializable record, every
// transition is a function of (state, now), and nothing here reads a clock or a
// store. That is what makes "fails three times, is skipped, comes back on its
// own twenty minutes later" a test rather than a claim.

import { MINUTE } from './time';

export type HostPenalty = {|
	// Failures inside the current window. Reset once the window lapses, so a host
	// that fails once a day is never suspended.
	failures: number,
	firstFailureAt: number,
	// Consecutive suspensions. Drives the backoff exponent, and is what makes a
	// persistently dead host cost less over time instead of the same every window.
	strikes: number,
	suspendedUntil: number,
|};

export type PenaltyState = { [host: string]: HostPenalty };

export const FAILURE_WINDOW_MS: number = 5 * MINUTE;
export const BASE_BACKOFF_MS: number = 5 * MINUTE;
export const MAX_BACKOFF_MS: number = 6 * 60 * MINUTE;
export const DEFAULT_THRESHOLD: number = 3;
// A record with no failures inside the window and no live suspension carries no
// information; keeping them would grow the stored object without bound as hosts
// come and go.
export const RETENTION_MS: number = 24 * 60 * MINUTE;

export type PenaltyOptions = {|
	threshold?: number,
	windowMs?: number,
	baseBackoffMs?: number,
	maxBackoffMs?: number,
|};

// An out-of-range or unparseable setting falls back to the default rather than
// being clamped. Clamping a 0 to 1 would turn "I typed something wrong" into
// "suspend every host on its first hiccup", which is the most destructive
// reading of the mistake rather than the most likely one.
function positiveOr(value: mixed, fallback: number): number {
	const parsed = Math.trunc(Number(value));
	return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function settings(options: ?PenaltyOptions) {
	const o = options || {};
	return {
		threshold: positiveOr(o.threshold, DEFAULT_THRESHOLD),
		windowMs: Math.max(1, Number(o.windowMs) || FAILURE_WINDOW_MS),
		baseBackoffMs: Math.max(1, Number(o.baseBackoffMs) || BASE_BACKOFF_MS),
		maxBackoffMs: Math.max(1, Number(o.maxBackoffMs) || MAX_BACKOFF_MS),
	};
}

function isFinitePositive(value: mixed): boolean {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Anything read back from storage has been through JSON and may have been
// hand-edited in a settings import, so a record is trusted only after it is
// checked. A malformed entry is dropped rather than repaired: guessing at what a
// corrupt penalty meant could suspend a host that never failed.
export function normalizePenaltyState(raw: mixed): PenaltyState {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: PenaltyState = {};
	for (const [host, value] of Object.entries((raw: any))) {
		if (!host || typeof host !== 'string') continue;
		if (!value || typeof value !== 'object') continue;
		const entry: any = value;
		if (!isFinitePositive(entry.failures) || !isFinitePositive(entry.firstFailureAt)) continue;
		if (!isFinitePositive(entry.strikes) || !isFinitePositive(entry.suspendedUntil)) continue;
		out[host] = {
			failures: Math.trunc(entry.failures),
			firstFailureAt: Math.trunc(entry.firstFailureAt),
			strikes: Math.trunc(entry.strikes),
			suspendedUntil: Math.trunc(entry.suspendedUntil),
		};
	}
	return out;
}

export function backoffFor(strikes: number, options: ?PenaltyOptions): number {
	const { baseBackoffMs, maxBackoffMs } = settings(options);
	const exponent = Math.max(0, Math.trunc(strikes) - 1);
	// The exponent is clamped so an absurd strike count does not compute Infinity
	// on the way to a value that was going to be capped anyway. Removing the clamp
	// does not change any result — `Math.min(cap, Infinity)` is still the cap —
	// which is why nothing asserts on it; it is hygiene, not a guard.
	const factor = 2 ** Math.min(exponent, 30);
	return Math.min(maxBackoffMs, baseBackoffMs * factor);
}

export function isSuspended(state: PenaltyState, host: string, now: number): boolean {
	const entry = state[host];
	return !!entry && entry.suspendedUntil > now;
}

export function suspendedUntil(state: PenaltyState, host: string): number {
	const entry = state[host];
	return entry ? entry.suspendedUntil : 0;
}

export type FailureResult = {|
	state: PenaltyState,
	suspended: boolean,
	until: number,
	strikes: number,
|};

export function recordFailure(state: PenaltyState, host: string, now: number, options: ?PenaltyOptions): FailureResult {
	const { threshold, windowMs } = settings(options);
	const previous = state[host];

	// A host that is already serving a suspension cannot fail: nothing is trying
	// it. Requests already in flight when the suspension landed still report back,
	// though, and counting those restarts the clock — three stragglers re-suspend
	// the host, double its backoff, and file a second diagnostic for the same
	// outage. Twenty links on one dead host produced seven diagnostics and a
	// backoff 64× longer than one failure earned.
	if (previous && previous.suspendedUntil > now) {
		return { state, suspended: false, until: previous.suspendedUntil, strikes: previous.strikes };
	}

	// Four cases, and conflating them is how a backoff stops backing off: a first
	// failure, another inside the window, one after the window lapsed, and the
	// first one after a served suspension. Only the second accumulates.
	//
	// The `failures > 0` half is not redundant. Suspending sets `failures: 0` and
	// moves `firstFailureAt` to the moment of suspension, so without it the first
	// failure after the backoff lapses lands exactly `backoff` milliseconds later
	// — inside the window when the two are equal — and is counted against a window
	// that has already been served. The window then expires mid-round and the
	// count never reaches the threshold again, so a permanently dead host serves
	// its first backoff and is never suspended a second time.
	const withinWindow = !!previous && previous.failures > 0 && (now - previous.firstFailureAt) <= windowMs;
	const failures = withinWindow ? previous.failures + 1 : 1;
	const firstFailureAt = withinWindow ? previous.firstFailureAt : now;
	// Strikes survive the window. A host that fails three times an hour, every
	// hour, is not healthier than one that fails three times a minute — it just
	// fails more slowly, and resetting the exponent here would give it the
	// shortest possible backoff every time.
	const strikes = previous ? previous.strikes : 0;

	if (failures < threshold) {
		return {
			state: { ...state, [host]: { failures, firstFailureAt, strikes, suspendedUntil: previous ? previous.suspendedUntil : 0 } },
			suspended: false,
			until: 0,
			strikes,
		};
	}

	const nextStrikes = strikes + 1;
	const until = now + backoffFor(nextStrikes, options);
	return {
		// Counters reset with the suspension: the next failure after it lapses
		// starts a fresh window, and only the strike count carries the history.
		state: { ...state, [host]: { failures: 0, firstFailureAt: now, strikes: nextStrikes, suspendedUntil: until } },
		suspended: true,
		until,
		strikes: nextStrikes,
	};
}

export function recordSuccess(state: PenaltyState, host: string): PenaltyState {
	if (!state[host]) return state;
	const next = { ...state };
	delete next[host];
	return next;
}

// Called before use rather than on a timer: there is no background tick here, so
// the only moment the state is known to be current is the moment it is read.
export function prunePenaltyState(state: PenaltyState, now: number, options: ?PenaltyOptions): PenaltyState {
	const { windowMs } = settings(options);
	const out: PenaltyState = {};
	for (const [host, entry] of Object.entries(state)) {
		const penalty: HostPenalty = (entry: any);
		if (penalty.suspendedUntil > now) { out[host] = penalty; continue; }
		const windowLive = penalty.failures > 0 && (now - penalty.firstFailureAt) <= windowMs;
		// Strikes are kept for a day past the last event so a host that fails every
		// afternoon does not get a first-offender backoff every afternoon.
		const recent = (now - Math.max(penalty.firstFailureAt, penalty.suspendedUntil)) <= RETENTION_MS;
		if (windowLive || (penalty.strikes > 0 && recent)) out[host] = penalty;
	}
	return out;
}

export type SuspendedHost = {| host: string, until: number, strikes: number |};

export function suspendedHosts(state: PenaltyState, now: number): SuspendedHost[] {
	return Object.entries(state)
		.map(([host, entry]) => ({ host, until: (entry: any).suspendedUntil, strikes: (entry: any).strikes }))
		.filter(({ until }) => until > now)
		.sort((a, b) => b.until - a.until);
}

export function formatBackoff(ms: number): string {
	// Guard on the raw value, not the rounded one: 30 seconds rounds to 1 and
	// would be reported as a whole minute it is not.
	if (ms < MINUTE) return 'under a minute';
	const minutes = Math.round(ms / MINUTE);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
	const hours = Math.round(minutes / 60);
	return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function formatSuspensionMessage(host: string, until: number, now: number, strikes: number): string {
	return `${host} failed repeatedly and will be skipped for ${formatBackoff(Math.max(0, until - now))} (consecutive backoff #${strikes}). It recovers on its own — no action needed.`;
}
