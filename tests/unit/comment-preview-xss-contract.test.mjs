import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const source = read('lib/modules/commentPreview.js');

test('wiki TOC decodes heading entities via a textarea, not a live div', () => {
	// A textarea's content model is RCDATA, so assigning markup to its innerHTML
	// decodes entities as text without instantiating live elements (no onerror XSS).
	assert.match(source, /const decoder = document\.createElement\('textarea'\);/);
	assert.match(source, /decoder\.innerHTML = contents;/);
	assert.match(source, /aid = decoder\.value;/);
});

test('wiki TOC no longer round-trips heading text through a live div innerHTML', () => {
	// The old, vulnerable pattern created a live <div> and assigned third-party
	// heading text to its innerHTML purely to decode entities for an anchor id.
	assert.doesNotMatch(source, /const tempDiv = document\.createElement\('div'\);\s*tempDiv\.innerHTML = contents;/);
});
