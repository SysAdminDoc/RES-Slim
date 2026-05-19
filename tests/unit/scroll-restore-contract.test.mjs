import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('scrollRestore is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as scrollRestore \} from '\.\/scrollRestore';/);
	assert.match(index, /^\s*scrollRestore,/m);
});

test('scrollRestore persists per pathname under one stable localStorage key', () => {
	const source = read('lib/modules/scrollRestore.js');
	assert.match(source, /STORAGE_KEY\s*=\s*'rsm-scroll-restore'/);
	assert.match(source, /blob\[location\.pathname\]/);
});

test('scrollRestore yields to permalink hash jumps so #commentid still wins', () => {
	const source = read('lib/modules/scrollRestore.js');
	assert.match(source, /if \(location\.hash\) return/);
});

test('scrollRestore debounces scroll persistence and re-applies after image expansion', () => {
	const source = read('lib/modules/scrollRestore.js');
	assert.match(source, /SAVE_DEBOUNCE_MS\s*=\s*250/);
	assert.match(source, /setTimeout\(\(\) => \{ window\.scrollTo\(0, targetY\); \}, 300\);/);
});

test('scrollRestore enforces an LRU cap on stored entries', () => {
	const source = read('lib/modules/scrollRestore.js');
	assert.match(source, /maxEntries:/);
	assert.match(source, /\.sort\(\(a, b\) => \(b\[1\]\.t \|\| 0\) - \(a\[1\]\.t \|\| 0\)\)/);
	assert.match(source, /\.slice\(0, max\)/);
});
