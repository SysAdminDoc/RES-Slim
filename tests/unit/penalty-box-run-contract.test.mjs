// The penalty box as it actually runs: persisting across page loads, surfacing a
// suspension in the diagnostics log, and never letting a storage failure become
// the user's problem.
//
// The pure state machine is covered in penalty-box-contract.test.mjs. What is
// only checkable here is the wiring — the module reads the store on load, writes
// what it decided, and files exactly one diagnostic per suspension no matter how
// many links triggered it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const PenaltyBox = await loadModule('lib/modules/penaltyBox.js', 'penalty-box-run', {
	dom: { url: 'https://old.reddit.com/r/test/' },
});

const { module: mod } = PenaltyBox;
const STORAGE_KEY = 'RES.penaltyBox.hosts';
const T0 = 1_700_000_000_000;

const storageGet = key => new Promise(resolve => { chrome.storage.local.get(key, r => resolve(r[key])); });
const storageSet = items => new Promise(resolve => { chrome.storage.local.set(items, resolve); });

async function errorLog() {
	const raw = await storageGet('RES.moduleErrorLog');
	return Array.isArray(raw) ? raw : [];
}

async function fresh() {
	await new Promise(resolve => chrome.storage.local.clear(resolve));
	PenaltyBox._resetForTests();
}

test('a suspension survives a page load', async () => {
	await fresh();

	// Three failures on this page...
	for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('imgur', T0 + (i * 1000));
	assert.equal(PenaltyBox.isHostSuspended('imgur', T0 + 3000), true);

	const stored = await storageGet(STORAGE_KEY);
	assert.ok(stored && stored.imgur, 'the decision has to outlive the page that made it');

	// ...and the next page load, which is a fresh module instance reading storage.
	PenaltyBox._resetForTests();
	assert.equal(PenaltyBox.isHostSuspended('imgur', T0 + 4000), false, 'before the store is read nothing is known, and nothing is claimed');
	await PenaltyBox.loadState(T0 + 4000);
	assert.equal(PenaltyBox.isHostSuspended('imgur', T0 + 4000), true, 'a host suspended on the last page must still be skipped on this one');
});

test('the suspension is visible in the diagnostics log, once', async () => {
	await fresh();
	for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('gfycat', T0 + (i * 1000));

	const entries = (await errorLog()).filter(e => e.moduleID === 'penaltyBox');
	assert.equal(entries.length, 1, 'a host going quiet must be visible, and once is enough');
	assert.match(entries[0].stage, /^host-suspended:gfycat$/);
	assert.match(entries[0].message, /gfycat failed repeatedly/);
	assert.match(entries[0].message, /recovers on its own/);

	// Twenty more links hitting the same dead host on the same page must not
	// bury the log — the first two failures are below the threshold, the third
	// suspends again, and the message is identical because nothing changed.
	for (let i = 0; i < 20; i++) await PenaltyBox.noteFailure('gfycat', T0 + 4000 + (i * 10));
	const after = (await errorLog()).filter(e => e.moduleID === 'penaltyBox');
	assert.equal(after.length, 1, 'one dead host on one page is one diagnostic');
});

test('a success on a previously failing host clears it everywhere', async () => {
	await fresh();
	for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('redgifs', T0 + (i * 1000));
	assert.equal(PenaltyBox.isHostSuspended('redgifs', T0 + 3000), true);

	await PenaltyBox.noteSuccess('redgifs', T0 + 3000);
	assert.equal(PenaltyBox.isHostSuspended('redgifs', T0 + 3000), false);
	const stored = await storageGet(STORAGE_KEY);
	assert.ok(!stored || !stored.redgifs, 'and the record must be gone from storage too, not just from memory');
});

test('the module reports what it is currently skipping', async () => {
	await fresh();
	for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('imgur', T0 + (i * 1000));
	for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('gfycat', T0 + 100 + (i * 1000));

	const listed = PenaltyBox.listSuspended(T0 + 5000);
	assert.deepEqual(listed.map(h => h.host).sort(), ['gfycat', 'imgur']);
	assert.ok(listed.every(h => h.until > T0 + 5000));

	assert.deepEqual(PenaltyBox.listSuspended(T0 + PenaltyBox.MAX_SUSPENSION_MS), [], 'nothing is skipped forever');
});

test('logging can be turned off without turning off the backoff', async () => {
	await fresh();
	mod.options.logSuspensions.value = false;
	try {
		for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('imgur', T0 + (i * 1000));
		assert.equal(PenaltyBox.isHostSuspended('imgur', T0 + 3000), true, 'the backoff is the feature; the log is a report of it');
		assert.deepEqual((await errorLog()).filter(e => e.moduleID === 'penaltyBox'), []);
	} finally {
		mod.options.logSuspensions.value = true;
	}
});

test('the configured threshold is the one that is applied', async () => {
	await fresh();
	mod.options.threshold.value = '1';
	try {
		await PenaltyBox.noteFailure('imgur', T0);
		assert.equal(PenaltyBox.isHostSuspended('imgur', T0 + 1), true, 'a threshold of one must suspend on the first failure');
	} finally {
		mod.options.threshold.value = '3';
	}
});

test('a corrupt store is discarded rather than trusted', async () => {
	await fresh();
	// Settings import writes whatever the file said, so this is reachable without
	// a bug anywhere in this module.
	await storageSet({ [STORAGE_KEY]: { imgur: { failures: 'many', suspendedUntil: 'forever' } } });

	await PenaltyBox.loadState(T0);
	assert.equal(PenaltyBox.isHostSuspended('imgur', T0), false, 'an unreadable record must not suspend a host that never failed');
});

test('an unwritable store does not cost the page its decision', async () => {
	await fresh();
	const set = chrome.storage.local.set;
	chrome.storage.local.set = () => { throw new Error('quota exceeded'); };
	try {
		for (let i = 0; i < 3; i++) await PenaltyBox.noteFailure('imgur', T0 + (i * 1000));
		assert.equal(PenaltyBox.isHostSuspended('imgur', T0 + 3000), true, 'the point of the module is to make failure cheaper — a failed write must not make it expensive again');
	} finally {
		chrome.storage.local.set = set;
	}
});

test('an unreadable store leaves the page working rather than throwing', async () => {
	await fresh();
	const get = chrome.storage.local.get;
	chrome.storage.local.get = () => { throw new Error('storage is gone'); };
	try {
		const state = await PenaltyBox.loadState(T0);
		assert.deepEqual(state, {}, 'no knowledge is the safe answer');
		assert.equal(PenaltyBox.isHostSuspended('imgur', T0), false);
	} finally {
		chrome.storage.local.get = get;
	}
});

test('an empty host name is ignored rather than stored under one', async () => {
	await fresh();
	assert.equal(await PenaltyBox.noteFailure('', T0), false);
	await PenaltyBox.noteSuccess('', T0);
	const stored = await storageGet(STORAGE_KEY);
	assert.ok(!stored || !Object.hasOwn(stored, ''), 'a nameless host must not become a real record');
});

test('a reader can let every suspended host back in', async () => {
	// `pardonAll` was exported and wired to nothing, so a host suspended by a
	// blip the reader has since fixed stayed skipped until its backoff expired,
	// with no way to say "try again now". It is a button in the settings.
	const option = PenaltyBox.module.options.pardon;
	assert.ok(option, 'the module has no pardon control');
	assert.equal(option.type, 'button');
	assert.equal(option.values.length, 1);
	assert.equal(typeof option.values[0].callback, 'function');

	PenaltyBox._resetForTests();
	await PenaltyBox.noteFailure('dead.example', Date.now());
	await PenaltyBox.noteFailure('dead.example', Date.now());
	await PenaltyBox.noteFailure('dead.example', Date.now());
	assert.equal(PenaltyBox.isHostSuspended('dead.example'), true, 'three failures should suspend the host');

	await option.values[0].callback();
	assert.equal(PenaltyBox.isHostSuspended('dead.example'), false, 'the button did not clear the suspension');
	assert.deepEqual(PenaltyBox.listSuspended(), []);
});
