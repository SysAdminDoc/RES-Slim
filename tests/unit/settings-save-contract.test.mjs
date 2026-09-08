// A save that fails partway used to leave storage ahead of the console.
//
// `commit()` calls `save()` per option and each one writes to storage as it
// goes. When one rejected -- storage near quota, or an `onChange` throwing --
// the catch put the in-memory values back and stopped there. The options that
// had already landed stayed in storage, the console showed the old values, and
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
	assert.match(stage, /await settleAll\(savedOptions\)/);
	assert.match(stage, /await settleAll\(Object\.entries\(stagedModules\)/);
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
// through, so they are what gets faked. The rollback itself -- which blob is put
// back, which is deleted, and when -- is the subject and runs for real.

const harness = {};
globalThis.__stageHarness = harness;

function reset({ modules = {}, stored = {}, failSaveAt = 0, failEnableAt = 0, failRestore = false, slowSaves = [] } = {}) {
	harness.store = new Map(Object.entries(stored).map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
	harness.modules = {};
	harness.enabled = {};
	harness.saveCount = 0;
	harness.enableCount = 0;
	harness.failSaveAt = failSaveAt;
	harness.failEnableAt = failEnableAt;
	harness.failRestore = failRestore;
	harness.slowSaves = new Set(slowSaves);
	harness.onSaveSettingsCalls = [];
	harness.gate = new Promise(resolve => { harness.releaseGate = resolve; });
	// A failed commit leaves the stage dirty on purpose, so the next test would
	// inherit edits naming options its own modules do not have.
	stage.reset();

	for (const [moduleID, { options, enabled = true }] of Object.entries(modules)) {
		harness.modules[moduleID] = {
			moduleID,
			options: Object.fromEntries(Object.entries(options).map(([key, value]) => [key, { value }])),
			onSaveSettings() { harness.onSaveSettingsCalls.push(moduleID); },
		};
		harness.enabled[moduleID] = enabled;
	}
}

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
		'./options': [
			'const h = () => globalThis.__stageHarness;',
			'export async function save(option) {',
			'	const harness = h();',
			'	harness.saveCount += 1;',
			'	const nth = harness.saveCount;',
			'	if (harness.failSaveAt === nth) throw new Error("storage quota exceeded");',
			'	if (harness.slowSaves.has(nth)) await harness.gate;',
			'	const { moduleID, key } = harness.locate(option);',
			'	const blob = harness.store.get(moduleID) || {};',
			'	harness.store.set(moduleID, { ...blob, [key]: { value: option.value } });',
			'}',
		].join('\n'),
		'./storage': [
			'const h = () => globalThis.__stageHarness;',
			'export const storage = {',
			'	async getNullable(key) {',
			'		const harness = h();',
			'		return harness.store.has(key) ? JSON.parse(JSON.stringify(harness.store.get(key))) : null;',
			'	},',
			'	async set(key, value) {',
			'		const harness = h();',
			'		if (harness.failRestore) throw new Error("rollback write failed");',
			'		harness.store.set(key, value);',
			'	},',
			'	async delete(key) {',
			'		const harness = h();',
			'		if (harness.failRestore) throw new Error("rollback write failed");',
			'		harness.store.delete(key);',
			'	},',
			'};',
		].join('\n'),
	},
});

// ---------------------------------------------------------------- the contract

test('a commit that succeeds writes every staged value and empties the stage', async () => {
	// The positive control. Without it the rollback assertions below are satisfied
	// by a `commit` that writes nothing at all.
	reset({
		modules: { showImages: { options: { maxWidth: 100, maxHeight: 100 } } },
		stored: { showImages: { maxWidth: { value: 100 } } },
	});
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
		modules: { showImages: { options: { maxWidth: 100, maxHeight: 100 } } },
		stored: { showImages: { maxWidth: { value: 100 }, maxHeight: { value: 100 } } },
		failSaveAt: 2,
	});
	const before = snapshotStore();

	stage.add('showImages', 'maxWidth', 640);
	stage.add('showImages', 'maxHeight', 480);

	await assert.rejects(stage.commit(), /storage quota exceeded/);

	assert.deepEqual(snapshotStore(), before, 'the first save is still sitting in storage');
	// And the console's own copy is back too, which is the half that already worked.
	assert.equal(harness.modules.showImages.options.maxWidth.value, 100);
	assert.equal(stage.isDirty(), true, 'a failed commit threw the edits away');
});

test('a module with nothing stored is left with nothing stored', async () => {
	// Restoring a snapshot of "absent" as an empty blob would leave a key behind
	// that `prune` deletes on sight and that no earlier state ever had.
	reset({
		modules: {
			showImages: { options: { maxWidth: 100 } },
			commentDepth: { options: { defaultDepth: 5 } },
		},
		failSaveAt: 2,
	});

	stage.add('showImages', 'maxWidth', 640);
	stage.add('commentDepth', 'defaultDepth', 9);

	await assert.rejects(stage.commit(), /storage quota exceeded/);

	assert.deepEqual(snapshotStore(), {}, 'a blob was invented for a module that had none');
	assert.equal(harness.store.has('showImages'), false);
});

test('a write still in flight cannot land behind the rollback', async () => {
	// Three saves: the second rejects, the third is still writing. Raising the
	// failure before the third settles rolls storage back and then lets the third
	// write over the rollback.
	reset({
		modules: {
			showImages: { options: { maxWidth: 100 } },
			commentDepth: { options: { defaultDepth: 5 } },
			nightMode: { options: { automaticNightMode: false } },
		},
		stored: {
			showImages: { maxWidth: { value: 100 } },
			commentDepth: { defaultDepth: { value: 5 } },
			nightMode: { automaticNightMode: { value: false } },
		},
		failSaveAt: 2,
		slowSaves: [3],
	});
	const before = snapshotStore();

	stage.add('showImages', 'maxWidth', 640);
	stage.add('commentDepth', 'defaultDepth', 9);
	stage.add('nightMode', 'automaticNightMode', true);

	const commit = stage.commit();
	// Long enough for a rollback that did not wait to have finished.
	await tick();
	harness.releaseGate();
	await assert.rejects(commit, /storage quota exceeded/);
	await tick();

	assert.deepEqual(snapshotStore(), before, 'the slow write landed on top of the rollback');
});

test('a failed module toggle is put back as well', async () => {
	reset({
		modules: {
			showImages: { options: { maxWidth: 100 }, enabled: true },
			commentDepth: { options: { defaultDepth: 5 }, enabled: false },
		},
		stored: { showImages: { maxWidth: { value: 100 } } },
		failEnableAt: 2,
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
	reset({
		modules: { showImages: { options: { maxWidth: 100 } } },
		stored: { showImages: { maxWidth: { value: 100 } } },
		failSaveAt: 1,
		failRestore: true,
	});

	stage.add('showImages', 'maxWidth', 640);

	await assert.rejects(stage.commit(), error => {
		// Not the original error on its own: that reads as though nothing was
		// written, which is the thing the reader most needs not to believe.
		assert.match(error.message, /could not be put back automatically/);
		assert.match(error.message, /storage quota exceeded/, 'the original failure is lost');
		assert.ok(!error.message.includes('—') && !error.message.includes('–'), 'no dashes in reader-facing text');
		return true;
	});
});
