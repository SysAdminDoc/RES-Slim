import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

// `lib/core/options/snapshot.js` uses Flow type annotations and imports the
// runtime extension storage module. To unit-test the pure helpers we strip
// Flow with flow-remove-types and inject an in-memory storage stub.

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const snapshotSource = fs.readFileSync(path.join(repoRoot, 'lib/core/options/snapshot.js'), 'utf8');

const memoryStorage = new Map();
const storageStub = {
	getAll() { return Promise.resolve(Object.fromEntries(memoryStorage.entries())); },
	set(key, value) { memoryStorage.set(key, value); return Promise.resolve(); },
};

// The restore point lives outside `RESoptions.` via `Storage.wrap`, so that
// module needs a stub too — otherwise importing snapshot.js drags the real
// extension environment in.
const wrapped = new Map();
// `RES.modulePrefs` lives outside the `RESoptions.` prefix, so the snapshot
// reads and writes it through the raw store rather than the prefixed one. Keyed
// storage on the same stub, so an enablement round-trip is testable.
const rawStorage = new Map();
const environmentStub = {
	wrap(key, getDefault) {
		return {
			get: () => Promise.resolve(wrapped.has(key) ? wrapped.get(key) : getDefault()),
			set: value => { wrapped.set(key, value); return Promise.resolve(); },
			delete: () => { wrapped.delete(key); return Promise.resolve(); },
		};
	},
	get(key) { return Promise.resolve(rawStorage.has(key) ? rawStorage.get(key) : null); },
	set(key, value) { rawStorage.set(key, value); return Promise.resolve(); },
};

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-snapshot');
fs.mkdirSync(tmpDir, { recursive: true });
const stubPath = path.join(tmpDir, 'storage-stub.mjs');
fs.writeFileSync(stubPath, 'export const storage = globalThis.__resSlimSnapshotStub;\n');
const envStubPath = path.join(tmpDir, 'environment-storage-stub.mjs');
fs.writeFileSync(envStubPath, [
	'export const wrap = (...a) => globalThis.__resSlimEnvStub.wrap(...a);',
	'export const get = (...a) => globalThis.__resSlimEnvStub.get(...a);',
	'export const set = (...a) => globalThis.__resSlimEnvStub.set(...a);',
	'',
].join('\n'));

const stubUrl = pathToFileURL(stubPath).href;
const envStubUrl = pathToFileURL(envStubPath).href;
const stripped = flowRemoveTypes(snapshotSource, { all: true }).toString()
	.replace("from './storage'", `from '${stubUrl}'`)
	.replace("from '../../environment/foreground/storage'", `from '${envStubUrl}'`);
const modulePath = path.join(tmpDir, 'snapshot.mjs');
fs.writeFileSync(modulePath, stripped);

globalThis.__resSlimSnapshotStub = storageStub;
globalThis.__resSlimEnvStub = environmentStub;
const {
	buildSnapshot, parseSnapshot, applySnapshot, serializeSnapshot, InvalidSnapshotError, SNAPSHOT_APP,
	diffSnapshots, describeDiff, applySnapshotGuarded, loadRestorePoint, revertToRestorePoint, clearRestorePoint,
	buildDefaultsSnapshot,
	SNAPSHOT_FORMAT_VERSION, MIN_SUPPORTED_FORMAT_VERSION, describeSnapshotOrigin,
} = await import(pathToFileURL(modulePath).href);

const snap = modules => ({ app: SNAPSHOT_APP, appVersion: '0.0.0', formatVersion: 1, exportedAt: '', modules, modulePrefs: null });

const MODULE_PREFS_KEY = 'RES.modulePrefs';

// --- enablement -------------------------------------------------------------
//
// `RES.modulePrefs` lives outside the `RESoptions.` prefix, so it was missing
// from the snapshot entirely: an export carried every option value and silently
// left every enable/disable behind, and a profile restored from a file came back
// with the right settings on the wrong set of modules.

test('a snapshot carries which modules are on, not only their options', async () => {
	memoryStorage.clear();
	rawStorage.clear();
	memoryStorage.set('hover', { width: { value: 42 } });
	rawStorage.set(MODULE_PREFS_KEY, { hover: true, karmaHide: false });

	const snapshot = await buildSnapshot({ appVersion: '1.0.0' });
	assert.deepEqual(snapshot.modulePrefs, { hover: true, karmaHide: false });

	// And it survives serialisation, which is the only form that reaches a user.
	const roundTripped = parseSnapshot(serializeSnapshot(snapshot));
	assert.deepEqual(roundTripped.modulePrefs, { hover: true, karmaHide: false });
});

test('only real booleans are kept, so a stray string cannot switch a module on', async () => {
	memoryStorage.clear();
	rawStorage.clear();
	rawStorage.set(MODULE_PREFS_KEY, { good: false, bad: 'true', alsoBad: 1, worse: null });

	const snapshot = await buildSnapshot({ appVersion: '1.0.0' });
	// `'true'` and `1` are both truthy. Coercing them would turn a module the user
	// disabled back on during a restore.
	assert.deepEqual(snapshot.modulePrefs, { good: false });
});

test('a file written before enablement was captured leaves enablement alone', async () => {
	rawStorage.clear();
	rawStorage.set(MODULE_PREFS_KEY, { hover: false });

	// The distinction that matters: absent means "this file does not say", which
	// must not be read as "no module is enabled". Reading it as `{}` would wipe
	// every toggle the user had whenever they imported an older export.
	const old = parseSnapshot(JSON.stringify({ app: SNAPSHOT_APP, modules: { hover: {} } }));
	assert.equal(old.modulePrefs, null);

	memoryStorage.clear();
	await applySnapshot(old);
	assert.deepEqual(rawStorage.get(MODULE_PREFS_KEY), { hover: false }, 'untouched');
});

test('enablement is replaced wholesale rather than merged', async () => {
	rawStorage.clear();
	rawStorage.set(MODULE_PREFS_KEY, { hover: true, leftover: true });
	memoryStorage.clear();

	await applySnapshot({ ...snap({ hover: {} }), modulePrefs: { hover: false } });
	// `leftover` is not in the snapshot, and merging would leave it on. A snapshot
	// is a complete statement of which modules are enabled.
	assert.deepEqual(rawStorage.get(MODULE_PREFS_KEY), { hover: false });
});

// --- reset to defaults ------------------------------------------------------

test('the defaults snapshot clears every stored blob and all enablement', async () => {
	memoryStorage.clear();
	rawStorage.clear();
	memoryStorage.set('hover', { width: { value: 42 } });
	memoryStorage.set('karmaHide', { hidePostScores: { value: false } });
	rawStorage.set(MODULE_PREFS_KEY, { karmaHide: true });

	const defaults = await buildDefaultsSnapshot({ appVersion: '1.0.0' });
	// An empty blob is how "no stored options" is spelled, so each module falls
	// back to what it declares without this file needing to know the defaults.
	assert.deepEqual(defaults.modules, { hover: {}, karmaHide: {} });
	assert.deepEqual(defaults.modulePrefs, {});
});

test('resetting goes through the guarded path, so it leaves a restore point', async () => {
	memoryStorage.clear();
	rawStorage.clear();
	wrapped.clear();
	memoryStorage.set('hover', { width: { value: 42 } });
	rawStorage.set(MODULE_PREFS_KEY, { karmaHide: true });

	const defaults = await buildDefaultsSnapshot({ appVersion: '1.0.0' });
	await applySnapshotGuarded(defaults, { appVersion: '1.0.0' });

	assert.deepEqual(memoryStorage.get('hover'), {}, 'the stored option is gone');
	assert.deepEqual(rawStorage.get(MODULE_PREFS_KEY), {}, 'and so is the enablement override');

	// Undoing 60 toggles by hand is not something a person can do, so the reset
	// being reversible is the whole reason it is safe to offer.
	const restorePoint = await loadRestorePoint();
	assert.deepEqual(restorePoint.modules.hover, { width: { value: 42 } });
	assert.deepEqual(restorePoint.modulePrefs, { karmaHide: true });

	await revertToRestorePoint();
	assert.deepEqual(memoryStorage.get('hover'), { width: { value: 42 } });
	assert.deepEqual(rawStorage.get(MODULE_PREFS_KEY), { karmaHide: true }, 'the undo has to bring enablement back too');
});

test('buildSnapshot captures every module blob with app metadata', async () => {
	memoryStorage.clear();
	memoryStorage.set('nightMode', { enabled: { value: true } });
	memoryStorage.set('commentDepth', { subredditCommentDepths: { value: [['askscience', 5]] } });

	const snapshot = await buildSnapshot({ appVersion: '0.5.0', now: new Date('2026-05-19T00:00:00Z') });

	assert.equal(snapshot.app, SNAPSHOT_APP);
	assert.equal(snapshot.appVersion, '0.5.0');
	assert.equal(snapshot.formatVersion, 1);
	assert.equal(snapshot.exportedAt, '2026-05-19T00:00:00.000Z');
	assert.deepEqual(snapshot.modules.nightMode, { enabled: { value: true } });
	assert.deepEqual(snapshot.modules.commentDepth, { subredditCommentDepths: { value: [['askscience', 5]] } });
});

test('round-trip preserves unknown future module IDs and option keys', async () => {
	memoryStorage.clear();
	memoryStorage.set('newCommentCount', { cleanupAfter: { value: 14 } });
	memoryStorage.set('futureModule_2099', {
		knownOption: { value: 'hello' },
		brandNewOption: { value: { nested: ['rich', { meta: true }] } },
	});

	const original = await buildSnapshot({ appVersion: '0.5.0' });
	const serialized = serializeSnapshot(original);
	const parsed = parseSnapshot(serialized);

	memoryStorage.clear();
	await applySnapshot(parsed);

	assert.deepEqual(memoryStorage.get('newCommentCount'), { cleanupAfter: { value: 14 } });
	assert.deepEqual(memoryStorage.get('futureModule_2099'), {
		knownOption: { value: 'hello' },
		brandNewOption: { value: { nested: ['rich', { meta: true }] } },
	});
});

test('parseSnapshot rejects payloads that are not RES-Slim exports', () => {
	assert.throws(() => parseSnapshot('null'), InvalidSnapshotError);
	assert.throws(() => parseSnapshot('{}'), InvalidSnapshotError);
	assert.throws(() => parseSnapshot('{"app": "some-other-extension", "modules": {}}'), InvalidSnapshotError);
	assert.throws(() => parseSnapshot('{"app": "res-slim"}'), InvalidSnapshotError);
});

test('parseSnapshot returns invalid-json error message verbatim', () => {
	try {
		parseSnapshot('not-json{');
		assert.fail('expected throw');
	} catch (e) {
		assert.ok(e instanceof InvalidSnapshotError);
		assert.match(e.message, /not valid JSON/);
	}
});

test('diffSnapshots names what changes, and what import will not touch', () => {
	const before = snap({
		nightMode: { enabled: { value: true } },
		commentDepth: { depth: { value: 5 } },
		onlyLocal: { a: { value: 1 } },
	});
	const after = snap({
		nightMode: { enabled: { value: false } },
		commentDepth: { depth: { value: 5 } },
		brandNew: { x: { value: 'y' } },
	});

	const diff = diffSnapshots(before, after);

	assert.deepEqual(diff.modulesChanged, ['nightMode']);
	assert.deepEqual(diff.modulesAdded, ['brandNew']);
	assert.equal(diff.modulesUnchanged, 1, 'commentDepth is identical');
	// Import does not delete modules the file omits. Saying so is the difference
	// between "my other settings survived" and assuming a full replacement.
	assert.deepEqual(diff.modulesUntouched, ['onlyLocal']);
	assert.equal(diff.optionsChanged, 2, 'one flipped option plus one added module option');
});

test('diffSnapshots compares values structurally, not by reference', () => {
	const before = snap({ m: { list: { value: [1, { a: 2 }] } } });
	const same = snap({ m: { list: { value: [1, { a: 2 }] } } });
	const different = snap({ m: { list: { value: [1, { a: 3 }] } } });

	assert.equal(diffSnapshots(before, same).optionsChanged, 0);
	assert.equal(diffSnapshots(before, different).optionsChanged, 1);
});

test('describeDiff says "no settings differed" rather than nothing at all', () => {
	assert.equal(describeDiff(diffSnapshots(snap({}), snap({}))), 'no settings differed');
	const d = diffSnapshots(snap({ a: { o: { value: 1 } } }), snap({ a: { o: { value: 2 } } }));
	assert.match(describeDiff(d), /1 option changed/);
});

test('applySnapshotGuarded writes a restore point before mutating anything', async () => {
	memoryStorage.clear();
	wrapped.clear();
	memoryStorage.set('nightMode', { enabled: { value: true } });

	await applySnapshotGuarded(snap({ nightMode: { enabled: { value: false } } }), { appVersion: '1.0.0' });

	assert.deepEqual(memoryStorage.get('nightMode'), { enabled: { value: false } }, 'import applied');
	const restore = await loadRestorePoint();
	assert.deepEqual(restore.modules.nightMode, { enabled: { value: true } }, 'pre-import state saved');
});

test('a failure partway through rolls every module back', async () => {
	memoryStorage.clear();
	wrapped.clear();
	memoryStorage.set('first', { o: { value: 'original-first' } });
	memoryStorage.set('second', { o: { value: 'original-second' } });

	// Fail on the second write, after the first has already landed. Without a
	// rollback this is the half-imported state the user was told did not happen.
	const realSet = storageStub.set;
	let writes = 0;
	storageStub.set = (key, value) => {
		writes++;
		if (writes === 2) throw new Error('storage exploded');
		return realSet(key, value);
	};

	await assert.rejects(
		applySnapshotGuarded(snap({
			first: { o: { value: 'imported-first' } },
			second: { o: { value: 'imported-second' } },
		}), { appVersion: '1.0.0' }),
		/storage exploded/,
	);

	storageStub.set = realSet;

	assert.deepEqual(memoryStorage.get('first'), { o: { value: 'original-first' } }, 'first module rolled back');
	assert.deepEqual(memoryStorage.get('second'), { o: { value: 'original-second' } }, 'second module untouched');
});

test('when rollback also fails the message says so instead of blaming the import', async () => {
	memoryStorage.clear();
	wrapped.clear();
	memoryStorage.set('only', { o: { value: 'original' } });

	const realSet = storageStub.set;
	storageStub.set = () => { throw new Error('storage is gone'); };

	await assert.rejects(
		applySnapshotGuarded(snap({ only: { o: { value: 'imported' } } }), { appVersion: '1.0.0' }),
		/could not be rolled back automatically[\s\S]*settingsRestorePoint/,
	);

	storageStub.set = realSet;
});

test('revertToRestorePoint puts the pre-import settings back and consumes itself', async () => {
	memoryStorage.clear();
	wrapped.clear();
	memoryStorage.set('m', { o: { value: 'before' } });

	await applySnapshotGuarded(snap({ m: { o: { value: 'after' } } }), { appVersion: '1.0.0' });
	assert.deepEqual(memoryStorage.get('m'), { o: { value: 'after' } });

	await revertToRestorePoint();

	assert.deepEqual(memoryStorage.get('m'), { o: { value: 'before' } });
	assert.equal(await loadRestorePoint(), null, 'restore point is consumed so undo is offered once');
});

test('revertToRestorePoint refuses when there is nothing saved', async () => {
	wrapped.clear();
	await assert.rejects(revertToRestorePoint(), /no saved pre-import state/);
});

test('a corrupt restore point does not break the console', async () => {
	wrapped.clear();
	await clearRestorePoint();
	wrapped.set('RES.settingsRestorePoint', { app: 'some-other-extension' });
	assert.equal(await loadRestorePoint(), null);
});

// --- format version ----------------------------------------------------------
//
// Importing is the one irreversible thing a settings page can do, and a file
// from a *newer* build is the case where doing it is worse than refusing:
// `migrate.js` is a 937-line ladder that only runs forward, so a layout this
// build has never seen cannot be interpreted, only written over a working
// configuration and hoped about.

function withFormat(formatVersion) {
	const payload = { app: SNAPSHOT_APP, appVersion: '0.0.0', exportedAt: '', modules: { pageTheme: { theme: { value: 'nord' } } } };
	if (formatVersion !== undefined) payload.formatVersion = formatVersion;
	return JSON.stringify(payload);
}

test('a snapshot from a newer build is refused, and says what to do about it', () => {
	const attempt = () => parseSnapshot(withFormat(SNAPSHOT_FORMAT_VERSION + 1));
	assert.throws(attempt, InvalidSnapshotError);

	let message = '';
	try { attempt(); } catch (e) { message = e.message; }
	assert.match(message, /newer version of RES-Slim/);
	assert.match(message, new RegExp(`file format ${SNAPSHOT_FORMAT_VERSION + 1}`), 'name the version in the file');
	assert.match(message, new RegExp(`this build reads ${SNAPSHOT_FORMAT_VERSION}`), 'and the one this build understands');
	assert.match(message, /Update RES-Slim/, 'an error the user can act on beats an accurate one they cannot');
	assert.match(message, /Nothing was changed/, 'and the first thing they need to know is that their settings survived');

	// Far-future too, not just off-by-one.
	assert.throws(() => parseSnapshot(withFormat(SNAPSHOT_FORMAT_VERSION + 99)), InvalidSnapshotError);
});

test('a snapshot at the current version imports unchanged', () => {
	const parsed = parseSnapshot(withFormat(SNAPSHOT_FORMAT_VERSION));
	assert.equal(parsed.formatVersion, SNAPSHOT_FORMAT_VERSION);
	assert.deepEqual(parsed.modules.pageTheme, { theme: { value: 'nord' } });
});

test('a file written before the field existed is read as the current layout', () => {
	// Absent means "written before formatVersion was added", which is the current
	// layout by definition — refusing those would break every export taken before
	// the field shipped.
	const parsed = parseSnapshot(withFormat(undefined));
	assert.equal(parsed.formatVersion, SNAPSHOT_FORMAT_VERSION);
	assert.deepEqual(parsed.modules.pageTheme, { theme: { value: 'nord' } });
});

test('a format version that is present but not a whole number is a corrupt file', () => {
	// Present-but-wrong is refused rather than coerced. Reading `"2"` as 1 is the
	// same mistake as accepting a newer file, in a smaller font.
	for (const bad of ['"1"', '1.5', 'true', 'null', '"abc"', '[]', '{}']) {
		const payload = `{"app": "${SNAPSHOT_APP}", "modules": {}, "formatVersion": ${bad}}`;
		if (bad === 'null') {
			// `null` is indistinguishable from absent in JSON round-trips, so it is
			// treated as absent rather than as corruption.
			assert.equal(parseSnapshot(payload).formatVersion, SNAPSHOT_FORMAT_VERSION);
			continue;
		}
		assert.throws(() => parseSnapshot(payload), InvalidSnapshotError, `formatVersion ${bad} must not be coerced`);
	}
});

test('a format older than this build still reads is refused rather than guessed at', () => {
	assert.equal(MIN_SUPPORTED_FORMAT_VERSION, 1, 'only format 1 has ever shipped');
	assert.throws(() => parseSnapshot(withFormat(0)), InvalidSnapshotError);
	assert.throws(() => parseSnapshot(withFormat(-1)), InvalidSnapshotError);

	let message = '';
	try { parseSnapshot(withFormat(0)); } catch (e) { message = e.message; }
	assert.match(message, /no longer reads/);
	assert.match(message, /Nothing was changed/);
});

test('a refused import never reaches storage', async () => {
	// The message says "nothing was changed", so nothing may be changed. parse
	// happens before apply in the console, and this pins that ordering from the
	// storage side rather than from the source.
	memoryStorage.clear();
	memoryStorage.set('pageTheme', { theme: { value: 'graphite' } });

	assert.throws(() => parseSnapshot(withFormat(SNAPSHOT_FORMAT_VERSION + 1)), InvalidSnapshotError);
	assert.deepEqual(memoryStorage.get('pageTheme'), { theme: { value: 'graphite' } }, 'the working configuration has to survive a refused import');
});

test('an import from a different build says so, and an identical one stays quiet', () => {
	const older = { app: SNAPSHOT_APP, appVersion: '0.31.0', formatVersion: SNAPSHOT_FORMAT_VERSION, exportedAt: '', modules: {} };
	assert.equal(describeSnapshotOrigin(older, '0.39.0'), 'exported by v0.31.0');

	const same = { ...older, appVersion: '0.39.0' };
	assert.equal(describeSnapshotOrigin(same, '0.39.0'), null, 'a note that always appears is furniture');

	const unknown = { ...older, appVersion: '' };
	assert.equal(describeSnapshotOrigin(unknown, '0.39.0'), null, 'nothing to say about a version the file did not record');
});
