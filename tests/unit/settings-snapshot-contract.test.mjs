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

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-snapshot');
fs.mkdirSync(tmpDir, { recursive: true });
const stubPath = path.join(tmpDir, 'storage-stub.mjs');
fs.writeFileSync(stubPath, 'export const storage = globalThis.__resSlimSnapshotStub;\n');

const stubUrl = pathToFileURL(stubPath).href;
const stripped = flowRemoveTypes(snapshotSource, { all: true }).toString()
	.replace("from './storage'", `from '${stubUrl}'`);
const modulePath = path.join(tmpDir, 'snapshot.mjs');
fs.writeFileSync(modulePath, stripped);

globalThis.__resSlimSnapshotStub = storageStub;
const { buildSnapshot, parseSnapshot, applySnapshot, serializeSnapshot, InvalidSnapshotError, SNAPSHOT_APP } = await import(pathToFileURL(modulePath).href);

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
