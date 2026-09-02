import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('codeBlockCopy module is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.ok(index.includes("from './codeBlockCopy'"));
	assert.ok(index.includes('codeBlockCopy,'));
});

test('codeBlockCopy is disabled by default', () => {
	const src = read('lib/modules/codeBlockCopy.js');
	assert.ok(src.includes('disabledByDefault = true'));
});

test('codeBlockCopy uses watchForElements for code block detection', () => {
	const src = read('lib/modules/codeBlockCopy.js');
	assert.ok(src.includes('watchForElements'));
	assert.ok(src.includes('.md pre'));
});

test('codeBlockCopy uses navigator.clipboard API', () => {
	const src = read('lib/modules/codeBlockCopy.js');
	assert.ok(src.includes('navigator.clipboard.writeText'));
});

test('codeBlockCopy has a SCSS module', () => {
	const scss = read('lib/css/modules/_codeBlockCopy.scss');
	assert.ok(scss.includes('.rsm-code-copy-btn'));
	assert.ok(scss.includes('prefers-reduced-motion'));
});

test('codeBlockCopy SCSS is imported in res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.ok(res.includes("@use 'modules/codeBlockCopy'"));
});
