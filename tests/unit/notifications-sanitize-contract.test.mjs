import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'lib/modules/notifications.js'), 'utf8');

test('string notification messages are sanitized before insertion', () => {
	// A raw insertAdjacentHTML(data.message) would let any caller interpolating
	// remote text inject scripts. The string branch must route through DOMPurify.
	assert.match(source, /import DOMPurify from 'dompurify';/);
	assert.match(source, /insertAdjacentHTML\('beforeend', DOMPurify\.sanitize\(data\.message\)\)/);
	assert.doesNotMatch(source, /insertAdjacentHTML\('beforeend', data\.message\)/);
});
