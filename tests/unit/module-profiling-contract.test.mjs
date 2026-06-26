import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('profiling exports getModuleTimings and getModuleSummary', () => {
	const src = read('lib/utils/profiling.js');
	assert.ok(src.includes('export function getModuleTimings'));
	assert.ok(src.includes('export function getModuleSummary'));
});

test('getModuleTimings parses performance entries with (stage) suffix', () => {
	const src = read('lib/utils/profiling.js');
	assert.ok(src.includes("getEntriesByType('measure')"));
	assert.ok(src.includes('moduleID'));
	assert.ok(src.includes('stage'));
	assert.ok(src.includes('durationMs'));
});

test('getModuleSummary returns entries sorted by totalMs descending', () => {
	const src = read('lib/utils/profiling.js');
	assert.ok(src.includes('b.totalMs - a.totalMs'));
});

test('init.js exposes rsmDiagnostics on window', () => {
	const src = read('lib/core/init.js');
	assert.ok(src.includes('window.rsmDiagnostics = getModuleSummary'));
});

test('init.js warns about slow modules >50ms', () => {
	const src = read('lib/core/init.js');
	assert.ok(src.includes('totalMs > 50'));
	assert.ok(src.includes('Slow modules'));
});

test('profiling functions are exported from utils index', () => {
	const src = read('lib/utils/index.js');
	assert.ok(src.includes('getModuleTimings'));
	assert.ok(src.includes('getModuleSummary'));
});
