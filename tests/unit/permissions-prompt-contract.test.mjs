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
	// The raw call is no longer awaited directly: Firefox's `chrome` namespace is
	// the callback-style alias, so awaiting its return value yields `undefined`
	// and every grant reads as a denial. `requestPermissions` takes the callback
	// and the promise, whichever the browser gives. The shape of that wrapper is
	// pinned by `permission-prompt-surface-contract`; what matters here is that
	// both halves of the request are still sent and the answer is still awaited.
	assert.match(source, /chrome\.permissions\.request\(\{ permissions, origins \}/);
	assert.match(source, /await requestPermissions\(\)/);
	assert.doesNotMatch(source, /handleMessage\(.*permissions\.request/s);
});
