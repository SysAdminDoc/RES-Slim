import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(import.meta.dirname, '.tmp-module-error-log');
fs.mkdirSync(tmpDir, { recursive: true });
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/moduleErrorLog.js'), 'utf8');
const modulePath = path.join(tmpDir, 'moduleErrorLog.mjs');
fs.writeFileSync(modulePath, flowRemoveTypes(source, { all: true }).toString());
const Log = await import(pathToFileURL(modulePath).href);

test('module errors normalise useful message and stack details', () => {
	const entry = Log.makeModuleErrorEntry('demo', 'go', { message: ' boom ', stack: 'Error: boom\n at demo' }, 123);
	assert.deepEqual(entry, {
		moduleID: 'demo',
		stage: 'go',
		timestamp: 123,
		message: 'boom',
		stack: 'Error: boom\n at demo',
	});
});

test('unknown thrown values still produce a readable local entry', () => {
	const entry = Log.makeModuleErrorEntry('', '', 'plain failure', 456);
	assert.equal(entry.moduleID, 'unknown-module');
	assert.equal(entry.stage, 'unknown-stage');
	assert.equal(entry.message, 'plain failure');
	assert.equal(entry.stack, '');
});

test('normalisation drops malformed entries and enforces the cap', () => {
	const entries = Log.normalizeModuleErrorEntries([
		{ moduleID: 'a', stage: 'go', timestamp: 3, message: 'third', stack: '' },
		{ moduleID: '', stage: 'go', timestamp: 2, message: 'bad', stack: '' },
		{ moduleID: 'b', stage: 'go', timestamp: 1, message: 'first', stack: '' },
	]);
	assert.deepEqual(entries.map(entry => entry.moduleID), ['a', 'b']);
});

test('appendModuleError prepends and caps newest entries', () => {
	const old = [
		Log.makeModuleErrorEntry('old-1', 'go', 'one', 1),
		Log.makeModuleErrorEntry('old-2', 'go', 'two', 2),
	];
	const next = Log.makeModuleErrorEntry('new', 'afterLoad', 'three', 3);
	const result = Log.appendModuleError(old, next, 2);
	assert.deepEqual(result.map(entry => entry.moduleID), ['new', 'old-1']);
});

test('formatModuleErrorLog is copyable plain text with no HTML interpolation', () => {
	const text = Log.formatModuleErrorLog([
		Log.makeModuleErrorEntry('demo', 'go', { message: '<script>', stack: 'bad' }, 100),
	]);
	assert.match(text, /demo \(go\)/);
	assert.match(text, /<script>/);
	assert.match(text, /bad/);
	assert.doesNotMatch(text, /<textarea/);
});

test('lifecycle catches feed the local error-log writer', () => {
	const source = fs.readFileSync(path.join(repoRoot, 'lib/core/modules/modules.js'), 'utf8');
	assert.match(source, /recordModuleError\(makeModuleErrorEntry\(module\.moduleID, stage, e\)\)/);
	assert.match(source, /recordModuleError\([\s\S]*?\.catch\(storageError/);
});

test('settings console exposes refresh, copy, clear, and a readonly log field', () => {
	const template = fs.readFileSync(path.join(repoRoot, 'lib/options/templates.js'), 'utf8');
	const controller = fs.readFileSync(path.join(repoRoot, 'lib/options/settingsConsole.js'), 'utf8');
	assert.match(template, /id="RESModuleErrorLogOutput" class="moduleErrorLogOutput"[^>]*readonly/);
	assert.match(template, /id="RESModuleErrorLogCopy"/);
	assert.match(template, /id="RESModuleErrorLogClear"/);
	assert.match(controller, /getModuleErrorLog\(\)/);
	assert.match(controller, /clearModuleErrorLog\(\)/);
	assert.match(controller, /navigator\.clipboard\.writeText/);
});

test('storage dashboard exposes the same local log and clear action', () => {
	const source = fs.readFileSync(path.join(repoRoot, 'lib/modules/storageDashboard.js'), 'utf8');
	assert.match(source, /getModuleErrorLog\(\)/);
	assert.match(source, /clearModuleErrorLog\(\)/);
	assert.match(source, /rsm-storageDashboard-errors-output/);
});
