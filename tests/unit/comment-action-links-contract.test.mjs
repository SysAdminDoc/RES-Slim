import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function read(rel) {
	return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

test('comment action modules do not use javascript: inert links', () => {
	for (const rel of [
		'lib/modules/arcticShift.js',
		'lib/modules/saveComments.js',
		'lib/modules/sourceSnudown.js',
		'lib/modules/viewDeleted.js',
	]) {
		assert.doesNotMatch(read(rel), /href=["']javascript:/i, `${rel} should use normal anchors with prevented default`);
	}
});

test('saveComments prevents default hash navigation and sanitizes replayed saved HTML', () => {
	const source = read('lib/modules/saveComments.js');
	assert.match(source, /event\.preventDefault\(\)/);
	assert.match(source, /import DOMPurify from 'dompurify'/);
	assert.match(source, /DOMPurify\.sanitize\(rawComment\)/);
	assert.doesNotMatch(source, /replace\(\s*\/<\(script\|iframe\|video\)/);
});

test('viewDeleted auto-load is capped and rate-limited', () => {
	const source = read('lib/modules/viewDeleted.js');
	assert.match(source, /createRateLimiter\(\{ tokens: 3, refillMs: 2000, maxConcurrent: 2 \}\)/);
	assert.match(source, /maxAutoLoad:/);
	assert.match(source, /autoLoadBudget = parseAutoLoadBudget\(module\.options\.maxAutoLoad\.value\)/);
	assert.match(source, /module\.options\.autoLoad\.value && autoLoadBudget > 0/);
	assert.match(source, /limiter\.schedule\(\(\) => ajax\(/);
});
