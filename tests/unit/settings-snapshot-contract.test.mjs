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
const environmentStub = {
	wrap(key, getDefault) {
		return {
			get: () => Promise.resolve(wrapped.has(key) ? wrapped.get(key) : getDefault()),
			set: value => { wrapped.set(key, value); return Promise.resolve(); },
			delete: () => { wrapped.delete(key); return Promise.resolve(); },
		};
	},
};

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-snapshot');
fs.mkdirSync(tmpDir, { recursive: true });
const stubPath = path.join(tmpDir, 'storage-stub.mjs');
fs.writeFileSync(stubPath, 'export const storage = globalThis.__resSlimSnapshotStub;\n');
const envStubPath = path.join(tmpDir, 'environment-storage-stub.mjs');
fs.writeFileSync(envStubPath, 'export const wrap = (...a) => globalThis.__resSlimEnvStub.wrap(...a);\n');

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
} = await import(pathToFileURL(modulePath).href);

const snap = modules => ({ app: SNAPSHOT_APP, appVersion: '0.0.0', formatVersion: 1, exportedAt: '', modules });

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
