import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const profiling = await loadFlowModule('lib/utils/profiling.js', 'module-profiling');

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

test('init.js warns about slow modules >50ms, in development only', () => {
	const src = read('lib/core/init.js');
	assert.ok(src.includes('totalMs > 50'));
	assert.ok(src.includes('Slow modules'));
	// The summary copies the whole measure buffer and regexes every entry. That
	// ran on every production page load to decide whether to print a warning
	// nobody asked for; `window.rsmDiagnostics` and the support dump call it when
	// somebody does.
	const guarded = src.slice(src.indexOf('window.rsmDiagnostics'), src.indexOf('totalMs > 50'));
	assert.match(guarded, /process.env.NODE_ENV !== 'development'/, 'the eager scan is not gated');
});

test('a finished measurement does not leave its mark behind', () => {
	// Nothing ever cleared either, so about five hundred entries accumulated per
	// page - half of them marks nobody reads. The measures have to survive: they
	// are what the support dump reports.
	performance.clearMarks();
	performance.clearMeasures();

	const tag = profiling.markStart();
	assert.equal(performance.getEntriesByType('mark').length, 1, 'markStart should leave a mark to measure from');
	profiling.markEnd(tag, 'exampleModule (contentStart)');

	assert.deepEqual(performance.getEntriesByType('mark').map(e => e.name), [], 'the mark outlived the measure it existed for');
	assert.deepEqual(profiling.getModuleTimings().map(t => `${t.moduleID}|${t.stage}`), ['exampleModule|contentStart']);

	performance.clearMeasures();
});

test('profiling functions are exported from utils index', () => {
	const src = read('lib/utils/index.js');
	assert.ok(src.includes('getModuleTimings'));
	assert.ok(src.includes('getModuleSummary'));
});
