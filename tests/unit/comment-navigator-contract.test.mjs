import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('comment navigator repairs malformed popular condition settings', () => {
	const source = read('lib/modules/commentNavigator.js');

	assert.match(source, /const DEFAULT_POPULAR_CONDITIONS = \{ type: 'commentLength', op: '>', kind: 'words', val: 0 \}/);
	assert.match(source, /function getPopularConditions\(\)/);
	assert.match(source, /JSON\.parse\(module\.options\.popularConditions\.value\)/);
	assert.match(source, /module\.options\.popularConditions\.value = JSON\.stringify\(DEFAULT_POPULAR_CONDITIONS\)/);
	assert.match(source, /Options\.save\(module\.options\.popularConditions\)\.catch/);
	assert.match(source, /get conditions\(\) \{ return getPopularConditions\(\); \}/);
});
