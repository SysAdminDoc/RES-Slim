import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('idbBackup exports backupStore, restoreStore, and clearBackup', () => {
	const src = read('lib/utils/idbBackup.js');
	assert.ok(src.includes('export async function backupStore'));
	assert.ok(src.includes('export async function restoreStore'));
	assert.ok(src.includes('export async function clearBackup'));
});

test('backup key format uses double-colon separator', () => {
	const src = read('lib/utils/idbBackup.js');
	assert.ok(src.includes('`idb-backup::${dbName}::${storeName}`'));
});

test('backupStore serializes records as JSON via Storage', () => {
	const src = read('lib/utils/idbBackup.js');
	assert.ok(src.includes('JSON.stringify(records)'));
	assert.ok(src.includes('Storage.set'));
});

test('restoreStore parses JSON and puts records back', () => {
	const src = read('lib/utils/idbBackup.js');
	assert.ok(src.includes('JSON.parse(raw)'));
	assert.ok(src.includes('store.put(record)'));
});

test('voteHistory uses oldVersion guard for schema creation', () => {
	const src = read('lib/modules/voteHistory.js');
	assert.ok(src.includes('oldVersion === 0'));
	assert.ok(src.includes('backupStore'));
});

test('mediaArchiveManifest uses oldVersion guard for schema creation', () => {
	const src = read('lib/modules/mediaArchiveManifest.js');
	assert.ok(src.includes('oldVersion === 0'));
	assert.ok(src.includes('backupStore'));
});
