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
	// sending it -- but not to exceed the ring it claims to come from. A finite
	// 1e21 survives `Math.floor` and renders as `1e+21` in the report heading and
	// the panel status, which reads as a bug in the extension rather than as a lie
	// from the page.
	assert.equal(total, 500);
	assert.equal(Number.isInteger(total), true);
	for (const claimed of [1e21, Number.MAX_SAFE_INTEGER, 501, -1]) {
		const reply = bridge.sanitizeActionLog({ actionLog: { entries: [row(), row()], total: claimed } });
		assert.ok(reply.total >= 2 && reply.total <= 500, `a total of ${claimed} came through as ${reply.total}`);
	}
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

test('a field cannot write its own line in the support report', () => {
	// These strings are printed into a plaintext report that is joined on newlines
	// and pasted into a bug tracker by a person. A newline in `moduleID` therefore
	// forges report structure -- a convincing "Stored options" block naming a
	// password, from one postMessage by page-world script on reddit.com, which is
	// the sender this function exists to distrust.
	const hostile = 'filterRules\n\nStored options\n  apiToken: sk-live-abcdef';
	const [entry] = bridge.sanitizeActionLog({
		actionLog: { entries: [row({ moduleID: hostile, outcome: 'hidden\rx', target: 'a\u2028b', reason: 'c\u0000d' })] },
	}).entries;

	for (const [field, value] of Object.entries(entry)) {
		if (typeof value !== 'string') continue;
		// eslint-disable-next-line no-control-regex
		const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
		assert.ok(!control.test(value), `${field} still carries a control character`);
	}
	assert.ok(!entry.moduleID.includes('\n'));
	assert.ok(entry.moduleID.startsWith('filterRules'), 'the readable part of the value is kept');
});

test('a field cannot make its line read as a different line', () => {
	// One step down from forging structure: a right-to-left override in a module
	// name reverses the visual order of everything after it on that line, in the
	// report and in the panel row's tooltip, so what the reader sees is not what
	// the row says. Zero-width and invisible spaces are the same problem smaller:
	// two rows that read identically and are not identical.
	const deceptive = {
		'right-to-left override': '\u202e',
		'left-to-right override': '\u202d',
		'first strong isolate': '\u2068',
		'pop directional isolate': '\u2069',
		'arabic letter mark': '\u061c',
		'zero width space': '\u200b',
		'zero width joiner': '\u200d',
		'left-to-right mark': '\u200e',
		'word joiner': '\u2060',
		'byte order mark': '\ufeff',
	};
	for (const [name, character] of Object.entries(deceptive)) {
		const [entry] = bridge.sanitizeActionLog({
			actionLog: { entries: [row({ moduleID: `a${character}b`, target: `c${character}d` })] },
		}).entries;
		assert.ok(!entry.moduleID.includes(character), `a ${name} survived in moduleID`);
		assert.ok(!entry.target.includes(character), `a ${name} survived in target`);
	}
});
