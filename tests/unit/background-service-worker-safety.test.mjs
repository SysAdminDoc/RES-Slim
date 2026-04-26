import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('background migrations do not depend on DOM globals', async () => {
	const source = await readFile('lib/core/migrate/migrate.js', 'utf8');

	assert.doesNotMatch(source, /\bdocument\./, 'Chrome MV3 service workers do not expose document');
	assert.doesNotMatch(source, /\bwindow\./, 'Chrome MV3 service workers do not expose window');
});
