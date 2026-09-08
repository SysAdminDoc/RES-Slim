// A save that fails partway used to leave storage ahead of the console.
//
// `commit()` calls `save()` per option and each one writes to storage as it
// goes. When one failed -- storage near quota, or an `onChange` throwing -- the
// catch put the in-memory values back and stopped there. The options that had
// already landed stayed in storage, the console showed the old values, and
// Discard reported a rollback it had not done. The landed values came back on
// the next load.
//
// These tests execute a failing commit rather than reading the source, because
// the source has said "there is a catch" the whole time it was wrong.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('settings saves await persistence before showing saved state', () => {
	const stage = read('lib/core/options/stage.js');
	const consoleSource = read('lib/options/settingsConsole.js');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(stage, /async function commitStagedOptions\(\)/);
	assert.match(stage, /const previousOptionValues = \[\]/);
	assert.match(stage, /await Promise\.all\(savedOptions\)/);
	assert.match(stage, /await Promise\.all\(Object\.entries\(stagedModules\)/);
	assert.match(stage, /previousOptionValues\.reverse\(\)/);
	assert.match(consoleSource, /let isSavingOptions = false/);
	assert.match(consoleSource, /async function saveAllStagedOptions\(\)/);
	assert.match(consoleSource, /await Options\.stage\.commit\(\)/);
	assert.match(consoleSource, /if \(isSavingOptions\) return/);
	assert.equal(locale.settingsConsoleSaving.message, 'Saving changes…');
});

// ---------------------------------------------------------------- the harness
//
// Storage, the module registry and `save()` are the boundary `stage.js` writes
// through, so they are what gets faked. The rollback itself -- which keys are
// put back, which blob is deleted, and in what order -- is the subject and runs
// for real.
//
// Two things the fakes have to match, because the code's correctness rests on
// them. Every real write goes through `withLockOn(key)`, a per-key mutex that
// runs queued work in issue order, so the fake keeps a queue per key. And
// `save()` is not async: it throws synchronously out of the commit loop when an
// `onChange` throws, which is one of the two failures the item names.

const harness = {};
globalThis.__stageHarness = harness;

function reset({
	stored = {},
	failSaveAt = 0,
	throwSaveAt = 0,
	failEnableAt = 0,
	failRestore = false,
	slowSaves = [],
} = {}) {
	harness.store = new Map(Object.entries(stored).map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
	harness.locks = new Map();
	harness.modules = {};
	harness.enabled = {};
	harness.saveCount = 0;
	harness.enableCount = 0;
	harness.failSaveAt = failSaveAt;
	harness.throwSaveAt = throwSaveAt;
	harness.failEnableAt = failEnableAt;
	harness.failRestore = failRestore;
	harness.slowSaves = new Set(slowSaves);
	harness.onSaveSettingsCalls = [];
	harness.gate = new Promise(resolve => { harness.releaseGate = resolve; });
	// Resolves when a slow save reaches the gate, which is strictly after the
	// commit has taken its storage snapshot. A test that writes before that point
	// is writing into the snapshot, not concurrently with the commit.
	harness.slowSaveReached = new Promise(resolve => { harness.noteSlowSave = resolve; });
	// A failed commit leaves the stage dirty on purpose, so the next test would
	// inherit edits naming options its own modules do not have.
	stage.reset();
}

// `withLockOn`, modelled. Work queued for a key runs after everything already
// queued for that key, whether that finished or threw.
harness.queue = (key, fn) => {
	const previous = harness.locks.get(key) || Promise.resolve();
	const next = previous.then(fn, fn);
	harness.locks.set(key, next.then(() => {}, () => {}));
	return next;
};

// The same search the real `save()` does, for the same reason: an option object
// carries no back-reference to the module that owns it.
harness.locate = option => {
	for (const mod of Object.values(harness.modules)) {
		for (const [key, candidate] of Object.entries(mod.options)) {
			if (candidate === option) return { moduleID: mod.moduleID, key };
		}
	}
	throw new Error('Option not found in module');
};

const defineModules = modules => {
	for (const [moduleID, { options, enabled = true }] of Object.entries(modules)) {
		harness.modules[moduleID] = {
			moduleID,
			options: Object.fromEntries(Object.entries(options).map(([key, value]) => [key, { value }])),
			onSaveSettings() { harness.onSaveSettingsCalls.push(moduleID); },
		};
		harness.enabled[moduleID] = enabled;
	}
};

const snapshotStore = () => JSON.parse(JSON.stringify(Object.fromEntries(harness.store)));
const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

const stage = await loadFlowModule('lib/core/options/stage.js', 'settings-save-stage', {
	stubs: {
		'../../utils/functional': [
			'export const isEmpty = value => Object.keys(value).length === 0;',
			'export const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);',
		].join('\n'),
		'../modules': [
			'const h = () => globalThis.__stageHarness;',
			'export const get = id => {',
			'	const mod = h().modules[id];',
			'	if (!mod) throw new Error("no such module: " + id);',
			'	return mod;',
			'};',
			'export const isEnabled = id => Boolean(h().enabled[id]);',
			'export const setEnabled = async (id, enable) => {',
			'	const harness = h();',
			'	harness.enableCount += 1;',
			'	const nth = harness.enableCount;',
			'	// The real one sets the in-memory flag before it persists, so a failed',
			'	// write leaves memory ahead of storage. Mirrored, or the rollback has',
			'	// nothing to undo here.',
			'	harness.enabled[id] = enable;',
			'	if (harness.failEnableAt === nth) throw new Error("module pref write failed");',
			'	harness.store.set("modulePrefs:" + id, enable);',
			'};',
		].join('\n'),
		'../../environment': 'export const i18n = (key, ...args) => key + ": " + args.join(", ");\n',
		'./options': [
			'const h = () => globalThis.__stageHarness;',
			'export function save(option) {',
			'	const harness = h();',
			'	harness.saveCount += 1;',
			'	const nth = harness.saveCount;',
			'	// Synchronous, like the real one: an `onChange` that throws never',
			'	// reaches storage and never produces a promise.',
			'	if (harness.throwSaveAt === nth) throw new Error("onChange threw");',
			'	const { moduleID, key } = harness.locate(option);',
			'	return harness.queue(moduleID, async () => {',
			'		if (harness.failSaveAt === nth) throw new Error("storage quota exceeded");',
			'		if (harness.slowSaves.has(nth)) { harness.noteSlowSave(); await harness.gate; }',
			'		const blob = harness.store.get(moduleID) || {};',
			'		harness.store.set(moduleID, { ...blob, [key]: { value: option.value } });',
			'	});',
			'}',
		].join('\n'),
		'./storage': [
			'const h = () => globalThis.__stageHarness;',
			'export const storage = {',
			'	getNullable(key) {',
			'		const harness = h();',
			'		return harness.queue(key, () => (',
			'			harness.store.has(key) ? JSON.parse(JSON.stringify(harness.store.get(key))) : null',
			'		));',
			'	},',
			'	set(key, value) {',
			'		const harness = h();',
			'		return harness.queue(key, () => {',
			'			if (harness.failRestore) throw new Error("rollback write failed");',
			'			harness.store.set(key, value);',
			'		});',
			'	},',
			'	delete(key) {',
			'		const harness = h();',
			'		return harness.queue(key, () => {',
			'			if (harness.failRestore) throw new Error("rollback write failed");',
			'			harness.store.delete(key);',
			'		});',
			'	},',
			'};',
		].join('\n'),
	},
});

// ---------------------------------------------------------------- the contract

test('a commit that succeeds writes every staged value and empties the stage', async () => {
	// The positive control. Without it the rollback assertions below are satisfied
	// by a `commit` that writes nothing at all.
	reset({ stored: { showImages: { maxWidth: { value: 100 } } } });
	defineModules({ showImages: { options: { maxWidth: 100, maxHeight: 100 } } });
	stage.add('showImages', 'maxWidth', 640);
	stage.add('showImages', 'maxHeight', 480);
	stage.addModule('showImages', false);

	await stage.commit();

	assert.deepEqual(snapshotStore().showImages, { maxWidth: { value: 640 }, maxHeight: { value: 480 } });
	assert.equal(harness.store.get('modulePrefs:showImages'), false);
	assert.equal(stage.isDirty(), false, 'a successful commit left the stage dirty');
	assert.deepEqual(harness.onSaveSettingsCalls, ['showImages']);
});

test('when the second of two saves rejects, storage is put back where it was', async () => {
	reset({
		stored: { showImages: { maxWidth: { value: 100 }, maxHeight: { value: 100 } } },
		failSaveAt: 2,
	});
	defineModules({ showImages: { options: { maxWidth: 100, maxHeight: 100 } } });
	const before = snapshotStore();

	stage.add('showImages', 'maxWidth', 640);
	stage.add('showImages', 'maxHeight', 480);

	await assert.rejects(stage.commit(), /storage quota exceeded/);

	assert.deepEqual(snapshotStore(), before, 'the first save is still sitting in storage');
	// And the console's own copy is back too, which is the half that already worked.
	assert.equal(harness.modules.showImages.options.maxWidth.value, 100);
	assert.equal(stage.isDirty(), true, 'a failed commit threw the edits away');
});

test('a save that throws before it reaches storage rolls back too', async () => {
	// `save()` is synchronous and throws out of the commit loop when an option's
	// `onChange` throws. That path never produces a promise, so it does not reach
	// the `Promise.all` at all, and a rollback written only for rejected writes
	// would miss it.
	reset({
		stored: { showImages: { maxWidth: { value: 100 }, maxHeight: { value: 100 } } },
		throwSaveAt: 2,
	});
	defineModules({ showImages: { options: { maxWidth: 100, maxHeight: 100 } } });
	const before = snapshotStore();

	stage.add('showImages', 'maxWidth', 640);
	stage.add('showImages', 'maxHeight', 480);

	await assert.rejects(stage.commit(), /onChange threw/);
	await tick();

	assert.deepEqual(snapshotStore(), before, 'the write that had already landed stayed');
	assert.equal(harness.modules.showImages.options.maxWidth.value, 100);
});

test('a module with nothing stored is left with nothing stored', async () => {
	// Restoring a snapshot of "absent" as an empty blob would leave a key behind
	// that `prune` deletes on sight and that no earlier state ever had.
	reset({ failSaveAt: 2 });
	defineModules({
		showImages: { options: { maxWidth: 100 } },
		commentDepth: { options: { defaultDepth: 5 } },
	});

	stage.add('showImages', 'maxWidth', 640);
	stage.add('commentDepth', 'defaultDepth', 9);

	await assert.rejects(stage.commit(), /storage quota exceeded/);

	assert.deepEqual(snapshotStore(), {}, 'a blob was invented for a module that had none');
	assert.equal(harness.store.has('showImages'), false);
});

test('the rollback puts back what it wrote and leaves the rest of the blob alone', async () => {
	// Another tab writes a different option into the same module blob while this
	// commit is failing. `userTagger`, `subredditBlacklist` and `commentNavigator`
	// all save from a content script, and the per-key mutex is per JavaScript
	// context, so it does not order this page against a reddit tab. Restoring the
	// snapshot wholesale would take that tab's write with it.
	reset({ stored: { showImages: { maxWidth: { value: 100 } } }, failSaveAt: 2, slowSaves: [1] });
	defineModules({ showImages: { options: { maxWidth: 100, maxHeight: 100 } } });

	stage.add('showImages', 'maxWidth', 640);
	stage.add('showImages', 'maxHeight', 480);

	const commit = stage.commit();
	// After the snapshot, or the concurrent write ends up *in* the snapshot and
	// even a wholesale restore puts it back. That is how the first version of this
	// test passed against the defect it was written for.
	await harness.slowSaveReached;
	harness.store.set('showImages', { ...harness.store.get('showImages'), hideNSFW: { value: true } });
	harness.releaseGate();

	await assert.rejects(commit, /storage quota exceeded/);

	assert.deepEqual(snapshotStore().showImages, {
		maxWidth: { value: 100 },
		hideNSFW: { value: true },
	}, 'the rollback took the other write with it');
});

test('a write still in flight cannot land behind the rollback', async () => {
	// The per-key queue is what guarantees this: the rollback's write for a key is
	// issued after the commit's writes for that key, so it runs last. The point of
	// the test is that the rollback does not read or write outside that queue.
	reset({
		stored: {
			showImages: { maxWidth: { value: 100 } },
			commentDepth: { defaultDepth: { value: 5 } },
			nightMode: { automaticNightMode: { value: false } },
		},
		failSaveAt: 2,
		slowSaves: [3],
	});
	defineModules({
		showImages: { options: { maxWidth: 100 } },
		commentDepth: { options: { defaultDepth: 5 } },
		nightMode: { options: { automaticNightMode: false } },
	});
	const before = snapshotStore();

	stage.add('showImages', 'maxWidth', 640);
	stage.add('commentDepth', 'defaultDepth', 9);
	stage.add('nightMode', 'automaticNightMode', true);

	const commit = stage.commit();
	await tick();
	harness.releaseGate();
	await assert.rejects(commit, /storage quota exceeded/);
	await tick();

	assert.deepEqual(snapshotStore(), before, 'the slow write landed on top of the rollback');
});

test('a failed module toggle is put back as well', async () => {
	reset({ stored: { showImages: { maxWidth: { value: 100 } } }, failEnableAt: 2 });
	defineModules({
		showImages: { options: { maxWidth: 100 }, enabled: true },
		commentDepth: { options: { defaultDepth: 5 }, enabled: false },
	});

	stage.add('showImages', 'maxWidth', 640);
	stage.addModule('showImages', false);
	stage.addModule('commentDepth', true);

	await assert.rejects(stage.commit(), /module pref write failed/);

	assert.deepEqual(snapshotStore().showImages, { maxWidth: { value: 100 } }, 'the option write survived the toggle failure');
	assert.equal(harness.enabled.showImages, true, 'the module was left switched off');
	assert.equal(harness.enabled.commentDepth, false, 'the module was left switched on');
});

test('when the rollback itself fails, the message says storage may be ahead', async () => {
	reset({ stored: { showImages: { maxWidth: { value: 100 } } }, failSaveAt: 1, failRestore: true });
	defineModules({ showImages: { options: { maxWidth: 100 } } });

	stage.add('showImages', 'maxWidth', 640);

	await assert.rejects(stage.commit(), error => {
		// Not the original error on its own: that reads as though nothing was
		// written, which is the thing the reader most needs not to believe. The
		// text lives in the locale file with everything else the console shows.
		assert.match(error.message, /^settingsSaveRollbackFailed: /);
		assert.match(error.message, /storage quota exceeded/, 'the original failure is lost');
		return true;
	});
});

test('the rollback message reads as a sentence a reader can act on', () => {
	const locale = JSON.parse(read('locales/locales/en.json'));
	const message = locale.settingsSaveRollbackFailed.message;

	assert.match(message, /\$1/, 'the reason is never substituted in');
	assert.match(message, /could not be put back/i);
	assert.ok(!message.includes('—') && !message.includes('–'), 'no dashes in reader-facing text');
});
