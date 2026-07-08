import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-csv');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(fs.readFileSync(path.join(repoRoot, 'lib/utils/csv.js'), 'utf8'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'csv.mjs');
fs.writeFileSync(modulePath, stripped);
const { csvCell, toCsvRow } = await import(pathToFileURL(modulePath).href);

test('csvCell prefixes formula-lead characters', () => {
	assert.equal(csvCell('=1+1'), `'=1+1`);
	assert.equal(csvCell('+1'), `'+1`);
	assert.equal(csvCell('@cmd'), `'@cmd`);
	assert.equal(csvCell('-cmd|x'), `'-cmd|x`);
});

test('csvCell leaves plain numbers (incl. negatives) untouched', () => {
	assert.equal(csvCell('-5'), '-5');
	assert.equal(csvCell('42'), '42');
	assert.equal(csvCell('-3.14'), '-3.14');
	assert.equal(csvCell(0), '0');
});

test('csvCell applies RFC-4180 quoting and stacks with formula prefixing', () => {
	assert.equal(csvCell('a,b'), '"a,b"');
	assert.equal(csvCell('say "hi"'), '"say ""hi"""');
	assert.equal(csvCell('=A1,B1'), `"'=A1,B1"`);
	assert.equal(csvCell(null), '');
});

test('toCsvRow joins encoded cells with commas', () => {
	assert.equal(toCsvRow(['a', '=b', 'c,d']), `a,'=b,"c,d"`);
});
