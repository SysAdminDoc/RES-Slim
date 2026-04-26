import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('permission prompt fails closed for malformed input and missing UI', () => {
	const source = read('lib/environment/background/permissions/prompt.entry.js');

	assert.match(source, /function parseJsonArrayParameter\(name: string\): Array<string>/);
	assert.match(source, /Array\.isArray\(value\) && value\.every\(item => typeof item === 'string'\)/);
	assert.match(source, /button instanceof HTMLButtonElement/);
	assert.match(source, /reportResult\(false\)/);
	assert.match(source, /await chrome\.permissions\.request\(\{ permissions, origins \}\)/);
	assert.doesNotMatch(source, /handleMessage\(.*permissions\.request/s);
});
