// The media-host penalty box: fail enough, get skipped, come back on your own.
//
// The state machine is pure and takes `now` as an argument, so "recovers after
// twenty minutes" is asserted by passing a later timestamp rather than by
// sleeping — and the exponential half is asserted by number, not by comment.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const PB = await loadFlowModule('lib/utils/penaltyBox.js', 'penalty-box', { deps: ['lib/utils/time.js'] });
const {
	BASE_BACKOFF_MS,
	DEFAULT_THRESHOLD,
	FAILURE_WINDOW_MS,
	MAX_BACKOFF_MS,
	RETENTION_MS,
	backoffFor,
	formatBackoff,
	formatSuspensionMessage,
	isSuspended,
	normalizePenaltyState,
	prunePenaltyState,
	recordFailure,
	recordSuccess,
	suspendedHosts,
	suspendedUntil,
} = PB;

const T0 = 1_700_000_000_000;

function failTimes(count, { host = 'imgur', from = T0, step = 1000, state = {}, options } = {}) {
	let current = state;
	let last = null;
	for (let i = 0; i < count; i++) {
		last = recordFailure(current, host, from + (i * step), options);
		current = last.state;
	}
	return { state: current, last };
}

test('a host is not skipped before it has failed enough', () => {
	const { state, last } = failTimes(DEFAULT_THRESHOLD - 1);
	assert.equal(last.suspended, false);
	assert.equal(isSuspended(state, 'imgur', T0 + 1), false, 'two failures is a bad day, not a dead host');
});

test('the threshold failure suspends the host, and it recovers on its own', () => {
	const { state, last } = failTimes(DEFAULT_THRESHOLD);
	assert.equal(last.suspended, true);
	assert.equal(last.strikes, 1);
	assert.equal(last.until - (T0 + 2000), BASE_BACKOFF_MS, 'the first suspension is one base backoff long');

	assert.equal(isSuspended(state, 'imgur', last.until - 1), true, 'still skipped a millisecond before it lapses');
	assert.equal(isSuspended(state, 'imgur', last.until), false, 'and let back in with no intervention');
	assert.equal(isSuspended(state, 'imgur', last.until + 1), false);
});

test('failures outside the window do not accumulate', () => {
	// One failure every window+1: a host that breaks occasionally must never be
	// suspended, however long the user browses.
	let state = {};
	for (let i = 0; i < 10; i++) {
		const result = recordFailure(state, 'imgur', T0 + (i * (FAILURE_WINDOW_MS + 1)), null);
		state = result.state;
		assert.equal(result.suspended, false, `failure ${i + 1} spaced past the window must not count toward a suspension`);
	}
});

test('a repeat offender backs off exponentially, and the exponent is bounded', () => {
	assert.equal(backoffFor(1), BASE_BACKOFF_MS);
	assert.equal(backoffFor(2), BASE_BACKOFF_MS * 2);
	assert.equal(backoffFor(3), BASE_BACKOFF_MS * 4);
	assert.equal(backoffFor(100), MAX_BACKOFF_MS, 'a bounded cap, not Infinity');
	assert.equal(backoffFor(1e9), MAX_BACKOFF_MS);
	assert.ok(Number.isFinite(backoffFor(1e9)), 'a suspension length must always be a number of milliseconds, never Infinity');
	assert.equal(backoffFor(0), BASE_BACKOFF_MS, 'a nonsense strike count still yields the shortest real backoff');
	assert.equal(backoffFor(-3), BASE_BACKOFF_MS);
});

test('a host that keeps failing after each suspension serves a longer one each time', () => {
	let state = {};
	let at = T0;
	const served = [];
	for (let round = 0; round < 4; round++) {
		const run = failTimes(DEFAULT_THRESHOLD, { from: at, state });
		state = run.state;
		served.push(run.last.until - (at + (DEFAULT_THRESHOLD - 1) * 1000));
		assert.equal(run.last.strikes, round + 1);
		at = run.last.until; // wait it out, then fail again
	}
	assert.deepEqual(served, [BASE_BACKOFF_MS, BASE_BACKOFF_MS * 2, BASE_BACKOFF_MS * 4, BASE_BACKOFF_MS * 8]);
});

test('failures reported while a host is already suspended change nothing', () => {
	// Requests already in flight when the suspension landed still come back and
	// report. Counting them restarts the window, re-suspends the host and doubles
	// its backoff for an outage it has already been penalised for.
	const { state, last } = failTimes(DEFAULT_THRESHOLD);
	const during = T0 + 3000;
	assert.equal(isSuspended(state, 'imgur', during), true);

	let current = state;
	for (let i = 0; i < 20; i++) {
		const result = recordFailure(current, 'imgur', during + i, null);
		assert.equal(result.suspended, false, 'a host that is not being tried cannot fail again');
		assert.equal(result.strikes, 1, 'and its strike count must not climb while it sits out');
		assert.equal(result.until, last.until, 'nor may its release be pushed back');
		current = result.state;
	}
	assert.deepEqual(current, state, 'twenty stragglers must leave the record exactly as it was');
});

test('one success clears the record entirely', () => {
	const { state } = failTimes(DEFAULT_THRESHOLD);
	assert.equal(isSuspended(state, 'imgur', T0 + 3000), true);

	const cleared = recordSuccess(state, 'imgur');
	assert.equal(isSuspended(cleared, 'imgur', T0 + 3000), false);
	assert.equal(suspendedUntil(cleared, 'imgur'), 0, 'a working host carries no history — the next outage starts from scratch');

	// And clearing a host that was never recorded is a no-op, not a new entry.
	const empty = {};
	assert.equal(recordSuccess(empty, 'imgur'), empty, 'an unknown host must not even allocate a new state object');
});

test('each host is penalised independently', () => {
	const first = failTimes(DEFAULT_THRESHOLD, { host: 'imgur' });
	const second = failTimes(1, { host: 'gfycat', state: first.state });
	assert.equal(isSuspended(second.state, 'imgur', T0 + 3000), true);
	assert.equal(isSuspended(second.state, 'gfycat', T0 + 3000), false, 'one dead host must not take the others down with it');
});

test('suspendedHosts reports what is currently skipped, newest expiry first', () => {
	let state = failTimes(DEFAULT_THRESHOLD, { host: 'imgur' }).state;
	state = failTimes(DEFAULT_THRESHOLD, { host: 'gfycat', from: T0 + 10, state }).state;

	const listed = suspendedHosts(state, T0 + 5000);
	assert.deepEqual(listed.map(h => h.host), ['gfycat', 'imgur']);
	assert.ok(listed.every(h => h.strikes === 1));

	assert.deepEqual(suspendedHosts(state, T0 + BASE_BACKOFF_MS + 60_000), [], 'once every backoff has lapsed nothing is skipped');
});

test('state is pruned of records that no longer say anything', () => {
	const stale = { dead: { failures: 1, firstFailureAt: T0, strikes: 0, suspendedUntil: 0 } };
	assert.deepEqual(prunePenaltyState(stale, T0 + 1000, null), stale, 'a live window is kept');
	assert.deepEqual(prunePenaltyState(stale, T0 + FAILURE_WINDOW_MS + 1, null), {}, 'a lapsed window with no strikes carries no information');

	const suspended = failTimes(DEFAULT_THRESHOLD).state;
	assert.ok(prunePenaltyState(suspended, T0 + 3000, null).imgur, 'a live suspension is always kept');
	assert.ok(prunePenaltyState(suspended, T0 + BASE_BACKOFF_MS + 60_000, null).imgur, 'and its strike count outlives it, so the next outage is not treated as a first offence');
	// Retention runs from the last event — the suspension's expiry — not from the
	// first failure, so the clock starts at `suspendedUntil`.
	const lastEvent = suspendedUntil(suspended, 'imgur');
	assert.ok(prunePenaltyState(suspended, lastEvent + RETENTION_MS, null).imgur, 'kept right up to the retention edge');
	assert.deepEqual(prunePenaltyState(suspended, lastEvent + RETENTION_MS + 1, null), {}, 'but not forever');
});

test('a corrupt stored record is dropped rather than repaired', () => {
	const raw = {
		good: { failures: 1, firstFailureAt: T0, strikes: 2, suspendedUntil: T0 + 500 },
		missingFields: { failures: 1 },
		wrongTypes: { failures: 'lots', firstFailureAt: T0, strikes: 0, suspendedUntil: 0 },
		negative: { failures: -1, firstFailureAt: T0, strikes: 0, suspendedUntil: 0 },
		notAnObject: 7,
	};
	const normalized = normalizePenaltyState(raw);
	assert.deepEqual(Object.keys(normalized), ['good']);
	assert.deepEqual(normalizePenaltyState(null), {});
	assert.deepEqual(normalizePenaltyState([1, 2]), {}, 'an array is not a penalty record');
	assert.deepEqual(normalizePenaltyState('{}'), {});
});

test('a hostile stored record cannot manufacture an unending suspension', () => {
	// Settings import accepts a file the user supplies, so the store is reachable
	// by hand. A record claiming Infinity would suspend a host permanently, which
	// no sequence of real failures can do.
	const normalized = normalizePenaltyState({ evil: { failures: 0, firstFailureAt: 0, strikes: 0, suspendedUntil: Infinity } });
	assert.deepEqual(normalized, {}, 'Infinity is not a finite timestamp');
	assert.deepEqual(normalizePenaltyState({ evil: { failures: 0, firstFailureAt: 0, strikes: 0, suspendedUntil: NaN } }), {});
});

test('the threshold is configurable and never degenerates below one', () => {
	const strict = failTimes(1, { options: { threshold: 1 } });
	assert.equal(strict.last.suspended, true, 'a threshold of one suspends on the first failure');

	// A nonsense value falls back to the default rather than being clamped to 1:
	// clamping would read a typo as "suspend every host on its first hiccup".
	for (const bad of [0, -5, 'abc', null, undefined, NaN]) {
		const nonsense = failTimes(DEFAULT_THRESHOLD - 1, { options: { threshold: bad } });
		assert.equal(nonsense.last.suspended, false, `threshold ${String(bad)} must fall back to the default, not to 1`);
		const atDefault = failTimes(DEFAULT_THRESHOLD, { options: { threshold: bad } });
		assert.equal(atDefault.last.suspended, true, `threshold ${String(bad)} must still suspend at the default count`);
	}

	const lenient = failTimes(4, { options: { threshold: 5 } });
	assert.equal(lenient.last.suspended, false);
});

test('the suspension message says what happened and that nothing is required', () => {
	const message = formatSuspensionMessage('imgur', T0 + BASE_BACKOFF_MS, T0, 1);
	assert.match(message, /^imgur failed repeatedly/);
	assert.match(message, /skipped for 5 minutes/);
	assert.match(message, /recovers on its own/, 'a diagnostic the user cannot act on must say so');

	assert.equal(formatBackoff(30_000), 'under a minute');
	assert.equal(formatBackoff(60_000), '1 minute');
	assert.equal(formatBackoff(120_000), '2 minutes');
	assert.equal(formatBackoff(60 * 60_000), '1 hour');
	assert.equal(formatBackoff(3 * 60 * 60_000), '3 hours');
});

test('linkScanner consults the penalty box before doing any work, and reports both outcomes', () => {
	const scanner = read('lib/modules/showImages/linkScanner.js');
	const stripped = scanner
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');

	assert.match(stripped, /PenaltyBox\.isHostSuspended\(siteModule\.moduleID\)/, 'the check must key on the handler, not the URL');
	assert.match(stripped, /PenaltyBox\.noteSuccess\(siteModule\.moduleID\)/);
	assert.match(stripped, /PenaltyBox\.noteFailure\(siteModule\.moduleID\)/);

	// The skip has to come before the expando is built and the lock awaited,
	// otherwise a suspended host still costs the DOM work and the wait — which is
	// most of what it cost in the first place.
	const skipAt = stripped.indexOf('isHostSuspended');
	const expandoAt = stripped.indexOf('new Expando(');
	assert.ok(skipAt > 0 && expandoAt > skipAt, 'the suspension check must precede constructing the expando');
});

test('penaltyBox is registered and does not claim to be an upstream port', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as penaltyBox \} from '\.\/penaltyBox';/);
	assert.match(index, /^\s*penaltyBox,/m);

	// Upstream ships a module with this name that does something else entirely.
	// The header has to keep saying so: the roadmap called this a port, and a
	// future reader diffing the two files deserves to know why they do not match.
	const mod = read('lib/modules/penaltyBox.js');
	assert.match(mod, /not the upstream module of the same name/i);
});
