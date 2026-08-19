// What a user is about to paste into a public bug report.
//
// The report exists to make "X is broken" answerable, so most of it is about
// completeness. One part is not: an option's value can be a subreddit list, a
// username, a filter rule, or — in a table field typed `password` — a
// credential, and none of that belongs in something written to be pasted
// somewhere else. So the value rules are asserted as rules rather than as
// whatever the current modules happen to hold, and the redaction cases are
// baitable: change `VERBATIM_TYPES` to include `text` and this file fails.
//
// `sanitizePageDiagnostics` is the other half. The console runs as an iframe on
// a reddit page, so any cross-origin frame on that page can post to it. The
// origin check lives in `trustedOrigin`; this covers the payload check, which is
// the part that stopped `context.js` adopting a hostile origin.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const Dump = await loadModule('lib/utils/supportDump.js', 'support-dump');

const {
	collectDeviations,
	describeOptionValue,
	formatSupportDump,
	sanitizePageDiagnostics,
	TIMING_LIMIT,
	ERROR_LIMIT,
} = Dump;

function baseInput(overrides = {}) {
	return {
		version: '0.48.0',
		browser: 'Chrome',
		browserVersion: '141',
		os: 'Windows',
		renderer: 'Current Reddit',
		pageType: 'comments',
		generatedAt: Date.UTC(2026, 7, 19, 12, 0, 0),
		timings: [],
		deviations: [],
		errors: [],
		drift: {},
		...overrides,
	};
}

test('a report with nothing wrong still names the version, the browser and the page', () => {
	const text = formatSupportDump(baseInput());
	assert.match(text, /^RES-Slim v0\.48\.0$/m);
	assert.match(text, /^Browser: Chrome 141 on Windows$/m);
	assert.match(text, /^Page: Current Reddit \(comments\)$/m);
	assert.match(text, /^Generated: 2026-08-19T12:00:00\.000Z$/m);
});

test('every section says "none" rather than going missing, so a reader can tell it was checked', () => {
	const text = formatSupportDump(baseInput());
	assert.match(text, /Settings that differ from default: none/);
	assert.match(text, /Slowest modules: none recorded/);
	assert.match(text, /Recent module errors: none/);
	assert.match(text, /Selector drift: none/);
});

test('missing timings are distinguished from no timings, and say how to get them', () => {
	const text = formatSupportDump(baseInput({ timings: null }));
	assert.match(text, /Slowest modules: unavailable \(open the settings console from a reddit page\)/);
	assert.doesNotMatch(text, /none recorded/);
});

test('the slowest modules are capped and the cap is stated', () => {
	const timings = Array.from({ length: TIMING_LIMIT + 5 }, (_, i) => ({
		moduleID: `module${i}`,
		totalMs: 100 - i,
		stages: { afterLoad: 100 - i },
	}));
	const text = formatSupportDump(baseInput({ timings }));
	assert.match(text, new RegExp(`Slowest modules \\(${TIMING_LIMIT} of ${TIMING_LIMIT + 5}\\)`));
	assert.match(text, /module0 100ms — afterLoad 100ms/);
	// The tail is dropped, and the heading is what says so.
	assert.doesNotMatch(text, /module9 /);
});

test('a module stage breakdown is ordered slowest first', () => {
	const text = formatSupportDump(baseInput({
		timings: [{ moduleID: 'showImages', totalMs: 90, stages: { go: 20, afterLoad: 70 } }],
	}));
	assert.match(text, /showImages 90ms — afterLoad 70ms, go 20ms/);
});

test('module errors are capped and the total is kept', () => {
	const errors = Array.from({ length: ERROR_LIMIT + 3 }, (_, i) => ({
		moduleID: `m${i}`,
		stage: 'go',
		timestamp: Date.UTC(2026, 7, 19),
		message: `failure ${i}`,
		stack: '',
	}));
	const text = formatSupportDump(baseInput({ errors }));
	assert.match(text, new RegExp(`Recent module errors \\(${ERROR_LIMIT} of ${ERROR_LIMIT + 3}\\)`));
	assert.doesNotMatch(text, /failure 12/);
});

test('drift is reported by renderer and page, not by its storage key', () => {
	const text = formatSupportDump(baseInput({
		drift: {
			'r2:comments': {
				pageType: 'r2:comments',
				firstSeen: 1,
				lastSeen: 2,
				findings: [{ surfaceName: 'comment body', status: 'missing', selector: '' }],
			},
		},
	}));
	assert.match(text, /Old Reddit — comments:/);
	assert.match(text, /comment body — not found/);
	assert.doesNotMatch(text, /r2:comments/);
});

// Deviations

test('a module left at its default contributes nothing', () => {
	const deviations = collectDeviations([
		{ moduleID: 'quiet', enabled: true, defaultEnabled: true, options: { a: { type: 'boolean', value: true, default: true } } },
	]);
	assert.deepEqual(deviations, []);
});

test('a module turned off against its default is reported', () => {
	const deviations = collectDeviations([
		{ moduleID: 'showImages', enabled: false, defaultEnabled: true, options: {} },
	]);
	assert.deepEqual(deviations, [{ moduleID: 'showImages', key: null, value: 'off', defaultValue: 'on' }]);
});

test('an option with no recorded default is skipped rather than reported as changed', () => {
	// `_loadModuleOptions` writes `default` before applying anything stored. An
	// option without one was never loaded, so there is nothing to compare, and
	// reporting all of them would bury the real deviations.
	const deviations = collectDeviations([
		{ moduleID: 'm', enabled: true, defaultEnabled: true, options: { a: { type: 'boolean', value: true } } },
	]);
	assert.deepEqual(deviations, []);
});

test('an array-valued option compares by contents, not by identity', () => {
	const unchanged = collectDeviations([
		{ moduleID: 'm', enabled: true, defaultEnabled: true, options: { k: { type: 'keycode', value: [65, false, false, false, false], default: [65, false, false, false, false] } } },
	]);
	assert.deepEqual(unchanged, []);

	const changed = collectDeviations([
		{ moduleID: 'm', enabled: true, defaultEnabled: true, options: { k: { type: 'keycode', value: [66, false, false, false, false], default: [65, false, false, false, false] } } },
	]);
	assert.equal(changed.length, 1);
});

test('a button option is never a deviation', () => {
	const deviations = collectDeviations([
		{ moduleID: 'm', enabled: true, defaultEnabled: true, options: { go: { type: 'button', value: 'x', default: 'y' } } },
	]);
	assert.deepEqual(deviations, []);
});

test('a malformed module list is skipped rather than thrown on', () => {
	assert.deepEqual(collectDeviations([null, undefined, {}, { moduleID: '' }, 'nonsense']), []);
});

// Redaction. These are the assertions that keep a credential out of a public paste.

test('a closed-vocabulary value is printed, because it can only be what the module defined', () => {
	assert.equal(describeOptionValue('boolean', true), 'on');
	assert.equal(describeOptionValue('boolean', false), 'off');
	assert.equal(describeOptionValue('enum', 'compact'), 'compact');
	assert.equal(describeOptionValue('select', 'mocha'), 'mocha');
	assert.equal(describeOptionValue('color', '#ff0000'), '#ff0000');
});

test('free text is reported by length and never by content', () => {
	assert.equal(describeOptionValue('text', 'hunter2'), 'set (7 characters)');
	assert.doesNotMatch(describeOptionValue('text', 'hunter2'), /hunter2/);
	assert.equal(describeOptionValue('text', ''), 'empty');
});

test('a subreddit list is reported by count and never by name', () => {
	assert.equal(describeOptionValue('list', 'pics, videos, aww'), '3 entries');
	assert.equal(describeOptionValue('list', 'pics'), '1 entry');
	assert.doesNotMatch(describeOptionValue('list', 'pics, videos'), /pics/);
});

test('a table is reported by row count, which is what keeps a password field out', () => {
	const rows = [['user', 'secret-token'], ['other', 'another-token']];
	assert.equal(describeOptionValue('table', rows), '2 rows');
	assert.doesNotMatch(describeOptionValue('table', rows), /secret-token/);
});

test('an unknown option type falls to the redacting branch, not the printing one', () => {
	// The default matters more than the listed cases: a type added later must be
	// redacted until someone decides otherwise, not printed by omission.
	assert.equal(describeOptionValue('somethingNew', 'private value'), 'set (13 characters)');
	assert.equal(describeOptionValue(undefined, 'private value'), 'set (13 characters)');
});

test('a deviation carries the redacted description, not the raw value', () => {
	const [deviation] = collectDeviations([
		{ moduleID: 'userTagger', enabled: true, defaultEnabled: true, options: { tags: { type: 'table', value: [['a', 'b']], default: [] } } },
	]);
	assert.deepEqual(deviation, { moduleID: 'userTagger', key: 'tags', value: '1 row', defaultValue: '0 rows' });
});

test('a redacted value survives into the formatted report', () => {
	const text = formatSupportDump(baseInput({
		deviations: collectDeviations([
			{ moduleID: 'filteReddit', enabled: true, defaultEnabled: true, options: { subs: { type: 'list', value: 'gonewild, drama', default: '' } } },
		]),
	}));
	assert.match(text, /filteReddit\.subs: 2 entries \(default empty\)/);
	assert.doesNotMatch(text, /gonewild/);
});

// The payload check on the postMessage reply.

test('a payload that is not a diagnostics reply is rejected', () => {
	for (const payload of [null, undefined, 'string', 42, {}, { context: { origin: 'https://www.reddit.com' } }, { diagnostics: 'yes' }]) {
		assert.equal(sanitizePageDiagnostics(payload), null, `accepted ${JSON.stringify(payload)}`);
	}
});

test('a well-formed reply survives intact', () => {
	const result = sanitizePageDiagnostics({
		diagnostics: { renderer: 'Current Reddit', pageType: 'comments', timings: [{ moduleID: 'showImages', totalMs: 12.5, stages: { go: 12.5 } }] },
	});
	assert.deepEqual(result, {
		renderer: 'Current Reddit',
		pageType: 'comments',
		timings: [{ moduleID: 'showImages', totalMs: 12.5, stages: { go: 12.5 } }],
	});
});

test('junk inside an otherwise valid reply is dropped, not adopted', () => {
	const result = sanitizePageDiagnostics({
		diagnostics: {
			renderer: { toString: () => 'hostile' },
			pageType: 12,
			timings: [
				null,
				{ moduleID: '', totalMs: 1 },
				{ moduleID: 'ok', totalMs: 'not a number' },
				{ moduleID: 'ok', totalMs: 5, stages: { go: 'nope', afterLoad: 3 } },
				'nonsense',
			],
		},
	});
	assert.equal(result.renderer, null);
	assert.equal(result.pageType, null);
	assert.deepEqual(result.timings, [{ moduleID: 'ok', totalMs: 5, stages: { afterLoad: 3 } }]);
});

test('a reply with no timings array is still a reply', () => {
	const result = sanitizePageDiagnostics({ diagnostics: { renderer: 'Old Reddit', pageType: 'linklist' } });
	assert.deepEqual(result, { renderer: 'Old Reddit', pageType: 'linklist', timings: [] });
});
