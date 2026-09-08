// The console asks the reddit page what happened on it, and has to assume the
// answer is hostile.
//
// `options.html` is embedded as an iframe inside reddit pages, which means
// page-world script on reddit.com can post to that window at the very origin the
// sender check accepts: reddit's own code, another extension, a userscript. The
// two channels that came before this one both say so in their headers and both
// run the payload through a shape check. This is the third, held to the same
// rule, because the failure modes are not theoretical: a non-numeric timestamp
// throws out of `toISOString` and kills the whole support report, a non-array
// `entries` throws out of `.map` and leaves the panel spinning, and a plausible
// row that nobody recorded ends up in a report the reader pastes in public.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const bridge = await loadFlowModule('lib/utils/actionLogBridge.js', 'action-log-bridge');

const row = (overrides = {}) => ({
	timestamp: 1_700_000_000_000,
	moduleID: 'filterRules',
	outcome: 'hidden',
	target: 't3_abc',
	reason: 'no-politics',
	detail: '',
	...overrides,
});

test('an ordinary reply comes through unchanged', () => {
	const reply = bridge.sanitizeActionLog({ actionLog: { entries: [row()], total: 12 } });
	assert.equal(reply.total, 12);
	assert.deepEqual(reply.entries, [row()]);
});

test('anything that is not a reply is not one', () => {
	for (const payload of [null, undefined, 'actionLog', 7, {}, { actionLog: null }, { actionLog: 'yes' }, { diagnostics: {} }]) {
		assert.equal(bridge.sanitizeActionLog(payload), null, `${JSON.stringify(payload)} was taken for a reply`);
	}
});

test('a timestamp that would throw is replaced rather than passed on', () => {
	// This is the one that does real damage: `new Date(x).toISOString()` throws a
	// RangeError, and both readers of these rows call it. In the panel that is an
	// unhandled rejection with the status stuck on its spinner; in the report it
	// is a build that dies with nothing to show for it.
	const nasty = [undefined, null, NaN, Infinity, -Infinity, 1e300, '1700000000000', {}];
	for (const timestamp of nasty) {
		const [entry] = bridge.sanitizeActionLog({ actionLog: { entries: [row({ timestamp })] } }).entries;
		assert.doesNotThrow(
			() => new Date(entry.timestamp).toISOString(),
			`a timestamp of ${String(timestamp)} still throws out of toISOString`,
		);
	}
});

test('a row of the wrong shape becomes a row of the right one', () => {
	const [entry] = bridge.sanitizeActionLog({
		actionLog: { entries: [{ moduleID: 42, outcome: null, target: ['t3_a'], reason: { toString: () => 'x' } }] },
	}).entries;

	assert.deepEqual(Object.keys(entry).sort(), ['detail', 'moduleID', 'outcome', 'reason', 'target', 'timestamp']);
	assert.equal(entry.moduleID, 'unknown-module');
	assert.equal(entry.outcome, 'built');
	assert.equal(entry.target, '');
	assert.equal(entry.reason, '');

	// A row that is not an object at all is dropped, not turned into an empty one.
	const { entries } = bridge.sanitizeActionLog({ actionLog: { entries: [null, 'x', 5, row()] } });
	assert.equal(entries.length, 1);
});

test('a reply cannot be longer, wider or more numerous than the log it claims to come from', () => {
	const flood = Array.from({ length: 5000 }, () => row({ target: 'x'.repeat(10_000) }));
	const { entries, total } = bridge.sanitizeActionLog({ actionLog: { entries: flood, total: 1e9 } });

	assert.ok(entries.length <= 500, `${entries.length} rows came through`);
	for (const entry of entries) assert.ok(entry.target.length <= 200, `a field of ${entry.target.length} characters came through`);
	// The count is allowed to exceed what was sent -- that is the whole point of
	// sending it -- but it is a count, so it has to be a whole number.
	assert.equal(total, 1e9);
	assert.equal(Number.isInteger(total), true);
});

test('entries is not an array, and nothing throws', () => {
	for (const entries of [undefined, null, 'rows', 5, { 0: row(), length: 1 }]) {
		const reply = bridge.sanitizeActionLog({ actionLog: { entries, total: 3 } });
		assert.deepEqual(reply.entries, []);
		// And the total cannot claim rows that are not there.
		assert.equal(reply.total, 3);
	}
});

test('a total that is nonsense falls back to what actually arrived', () => {
	for (const total of [undefined, NaN, 'lots', -4, null]) {
		const reply = bridge.sanitizeActionLog({ actionLog: { entries: [row(), row()], total } });
		assert.equal(reply.total, 2, `a total of ${String(total)} produced ${reply.total}`);
	}
});
