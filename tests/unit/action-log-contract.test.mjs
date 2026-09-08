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

// The four modules that change what is on the page without saying anything.
const WRITERS = [
	'lib/modules/filterRules.js',
	'lib/modules/removePromoted.js',
	'lib/modules/showImages/linkScanner.js',
	'lib/modules/penaltyBox.js',
];

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

	// There is no field a post's title or body could go in. That is the weaker
	// half of the promise -- see the call-site contract below for the other half.
	const source = codeOnly(readRepoFile('lib/utils/actionLog.js'));
	for (const field of ['body', 'title', 'text', 'html']) {
		assert.ok(!new RegExp(`^\\t${field}:`, 'm').test(source), `the entry has a \`${field}\` field`);
	}
});

test('no writer puts what it was reading into a field that does exist', () => {
	// Field names are the weaker half. Nothing stops a writer putting a post's
	// title into `target` or `detail`, which is the same leak through a door left
	// open, so the assertion has to be about the call sites rather than the type.
	const accessors = /\b(getTitle|getBody|getSelftext|selftext|textContent|innerText|innerHTML|outerHTML|getPostFlair|getUserFlair)\b/;
	const blocks = [];
	for (const file of WRITERS) {
		const source = codeOnly(readRepoFile(file));
		for (const match of source.matchAll(/recordAction\(\{[\s\S]*?\n\t*\}\)/g)) {
			blocks.push({ file, block: match[0] });
		}
	}

	assert.equal(blocks.length, 5, `expected every writer's call sites; found ${blocks.length}`);
	for (const { file, block } of blocks) {
		const found = block.match(accessors);
		assert.equal(found, null, `${file} records ${found && found[0]}, which is what was on the page rather than what was done to it`);
	}
});

test('a limit that is not a number reads nothing, rather than everything', () => {
	// `Math.min(NaN, n)` is NaN and `slice(n - NaN)` is `slice(0)`, so the old
	// shape answered a nonsense cap with the whole log -- the wrong way round for
	// something whose job is to bound an answer.
	fill(10);
	assert.deepEqual(log.readActionLog(NaN), []);
	assert.deepEqual(log.readActionLog('20'), []);
	assert.deepEqual(log.readActionLog(-5), []);
	assert.equal(log.readActionLog(2.9).length, 2, 'a fractional limit should round down, not up');
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

test('the report gets counts, never the things the counts are about', () => {
	// A reddit fullname is not anonymous: one public `api/info?id=t3_x` call turns
	// a pasted report back into the list of posts that were on screen. The report
	// already reduces every stored option that could carry something private to a
	// count, and this is the log held to that same rule.
	log.clearActionLog();
	assert.deepEqual(log.summariseActionLog([]), []);

	fill(3, { moduleID: 'filterRules', outcome: 'hidden', reason: 'no-politics' });
	log.recordAction({ moduleID: 'filterRules', outcome: 'dimmed', target: 't3_zz', reason: 'long-titles' });
	log.recordAction({ moduleID: 'showImages', outcome: 'refused', target: 'i.imgur.com', reason: 'imgur' });

	let summary = log.summariseActionLog(log.readActionLog());
	let text = summary.join('\n');

	assert.deepEqual(summary, [
		'filterRules: hidden 3 times across 2 rules or hosts',
		'filterRules: dimmed 1 time across 2 rules or hosts',
		'showImages: refused 1 time across 1 rule or host',
	], text);

	summary = log.summariseActionLog(log.readActionLog());
	text = summary.join('\n');

	// A module id is a value as far as this function is concerned, and one with a
	// colon in it must not be taken apart in the wrong place. This is what a
	// summary keyed on a joined string does.
	log.clearActionLog();
	log.recordAction({ moduleID: 'weird: name', outcome: 'hidden', target: 't3_a', reason: 'r1' });
	log.recordAction({ moduleID: 'weird: name', outcome: 'hidden', target: 't3_b', reason: 'r2' });
	assert.deepEqual(
		log.summariseActionLog(log.readActionLog()),
		['weird: name: hidden 2 times across 2 rules or hosts'],
	);

	// And two different pairs that would join to the same string stay apart. This
	// is what keying on a joined value costs when either half comes from the page.
	log.clearActionLog();
	log.recordAction({ moduleID: 'a: b', outcome: 'c', target: 't3_a' });
	log.recordAction({ moduleID: 'a', outcome: 'b: c', target: 't3_b' });
	assert.equal(
		log.summariseActionLog(log.readActionLog()).length,
		2,
		'two different module and outcome pairs were counted as one',
	);

	log.clearActionLog();
	fill(3, { moduleID: 'filterRules', outcome: 'hidden', reason: 'no-politics' });
	log.recordAction({ moduleID: 'filterRules', outcome: 'dimmed', target: 't3_zz', reason: 'long-titles' });
	log.recordAction({ moduleID: 'showImages', outcome: 'refused', target: 'i.imgur.com', reason: 'imgur' });

	// Not one identifier from any of the five entries survives.
	for (const leak of ['t3_', 'no-politics', 'long-titles', 'imgur']) {
		assert.ok(!text.includes(leak), `the summary carries ${leak}`);
	}
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
	assert.deepEqual(Object.keys(writers), WRITERS);
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
