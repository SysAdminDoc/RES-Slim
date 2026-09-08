// The record of what the extension did to the page in front of you.
//
// Readers asked for one specific thing this quarter: a way to tell which filter
// is hiding a post, so they can trust their filters. The same gap covers
// everything else this extension does silently -- an expando refused for a
// permission, a host in the penalty box, a promoted record removed.
//
// Two properties matter more than the contents. It is capped, because infinite
// scroll turns "one entry per post" into an unbounded array on a session that
// never navigates; and it holds decisions rather than content, because a log of
// what you were reading is exactly the sort of thing that must not exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';

const log = await loadFlowModule('lib/utils/actionLog.js', 'action-log');

function fill(count, overrides = {}) {
	log.clearActionLog();
	for (const index of Array.from({ length: count }, (_, at) => at)) {
		log.recordAction({
			moduleID: 'filterRules',
			outcome: 'hidden',
			target: `t3_${index}`,
			reason: 'rule-1',
			timestamp: 1_700_000_000_000 + index,
			...overrides,
		});
	}
}

test('the log never grows past its cap, however long the page lives', () => {
	// An infinite-scroll session appends posts for as long as the reader keeps
	// going, and every one of them is a decision. A ring that only trims on read,
	// or trims one entry at a time behind a burst, is a leak with a friendly name.
	fill(log.ACTION_LOG_CAP * 3);
	assert.equal(log.actionLogSize(), log.ACTION_LOG_CAP, `the log grew to ${log.actionLogSize()}`);

	// And it is the *oldest* that go. The newest entry is the one a reader is
	// asking about.
	const [newest] = log.readActionLog(1);
	assert.equal(newest.target, `t3_${log.ACTION_LOG_CAP * 3 - 1}`);
	const all = log.readActionLog();
	assert.equal(all[all.length - 1].target, `t3_${log.ACTION_LOG_CAP * 2}`, 'the oldest survivor is one cap back');
});

test('a burst larger than the cap still leaves exactly the cap', () => {
	// Reddit appends a whole page of posts at once, so the array can pass the cap
	// by two hundred between reads rather than by one.
	log.clearActionLog();
	for (const index of Array.from({ length: 900 }, (_, at) => at)) {
		log.recordAction({ moduleID: 'removePromoted', outcome: 'removed', target: `t3_${index}` });
	}
	assert.equal(log.actionLogSize(), log.ACTION_LOG_CAP);
});

test('the newest is first, because that is the one being asked about', () => {
	fill(5);
	const rows = log.readActionLog();
	assert.deepEqual(rows.map(row => row.target), ['t3_4', 't3_3', 't3_2', 't3_1', 't3_0']);
	assert.deepEqual(log.readActionLog(2).map(row => row.target), ['t3_4', 't3_3']);
	assert.deepEqual(log.readActionLog(0), []);
	// Asking for more than there is returns what there is, rather than padding.
	assert.equal(log.readActionLog(50).length, 5);
});

test('an entry records the decision, never the thing that was decided about', () => {
	log.clearActionLog();
	const entry = log.recordAction({
		moduleID: 'filterRules',
		outcome: 'hidden',
		target: 't3_abc',
		reason: 'no-politics',
		detail: 'keyword contains election',
	});

	assert.deepEqual(Object.keys(entry).sort(), ['detail', 'moduleID', 'outcome', 'reason', 'target', 'timestamp']);
	assert.equal(entry.target, 't3_abc');

	// There is no field a post's title or body could go in, and that is the
	// point: a log of what you were reading must not be constructible from this.
	const source = codeOnly(readRepoFile('lib/utils/actionLog.js'));
	for (const field of ['body', 'title', 'text', 'html']) {
		assert.ok(!new RegExp(`^\\t${field}:`, 'm').test(source), `the entry has a \`${field}\` field`);
	}
});

test('a field long enough to be content is truncated rather than stored whole', () => {
	log.clearActionLog();
	const entry = log.recordAction({
		moduleID: 'x',
		outcome: 'hidden',
		target: 'a'.repeat(5000),
		reason: 'b'.repeat(5000),
	});
	assert.ok(entry.target.length < 250, `target was ${entry.target.length} characters`);
	assert.ok(entry.reason.length < 250);
	assert.ok(entry.target.endsWith('…'), 'and says it was cut');
});

test('a missing or nonsense field does not produce a broken row', () => {
	log.clearActionLog();
	const entry = log.recordAction({ moduleID: '', outcome: 'hidden' });
	assert.equal(entry.moduleID, 'unknown-module');
	assert.equal(entry.target, '');
	assert.ok(Number.isFinite(entry.timestamp));
});

test('the report rendering says what happened, and says so when nothing did', () => {
	log.clearActionLog();
	assert.match(log.describeActionLog(), /Nothing recorded/);

	fill(3, { moduleID: 'showImages', outcome: 'refused', reason: 'imgur' });
	const described = log.describeActionLog();
	assert.equal(described.split('\n').length, 3);
	assert.match(described, /showImages: refused t3_2 via imgur/);
	assert.equal(log.describeActionLog(1).split('\n').length, 1);
});

test('the modules that make silent decisions all write to it', () => {
	// The log is only worth having if the decisions a reader cannot see are in
	// it. These four are the ones that change what is on the page without saying
	// anything: a filter hiding a post, a promoted record removed, an expando
	// refused, and a host suspended after repeated failures.
	const writers = {
		'lib/modules/filterRules.js': /recordAction\(\{[\s\S]{0,200}moduleID: 'filterRules'/,
		'lib/modules/removePromoted.js': /recordAction\(\{[\s\S]{0,200}moduleID: 'removePromoted'/,
		'lib/modules/showImages/linkScanner.js': /recordAction\(\{[\s\S]{0,200}moduleID: 'showImages'/,
		'lib/modules/penaltyBox.js': /recordAction\(\{[\s\S]{0,200}moduleID: 'penaltyBox'/,
	};
	for (const [file, pattern] of Object.entries(writers)) {
		assert.match(readRepoFile(file), pattern, `${file} makes a silent decision and does not record it`);
	}

	// And the expando records both outcomes, not only the happy one: "it was
	// refused" is the answer to the question a reader is actually asking.
	const scanner = readRepoFile('lib/modules/showImages/linkScanner.js');
	assert.match(scanner, /outcome: 'built'/);
	assert.match(scanner, /outcome: 'refused'/);
});

test('nothing writes the log anywhere it could outlive the tab', () => {
	// In memory, per page. A record of what you were reading has no business in
	// storage, and the cheapest way to keep that true is for there to be no code
	// that could put it there.
	const source = codeOnly(readRepoFile('lib/utils/actionLog.js'));
	for (const sink of ['Storage', 'localStorage', 'sessionStorage', 'chrome.storage', 'indexedDB', 'fetch(']) {
		assert.ok(!source.includes(sink), `actionLog reaches for ${sink}`);
	}
});
