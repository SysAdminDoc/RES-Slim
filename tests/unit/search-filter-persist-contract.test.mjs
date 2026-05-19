import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('searchFilterPersist is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as searchFilterPersist \} from '\.\/searchFilterPersist';/);
	assert.match(index, /^\s*searchFilterPersist,/m);
});

test('searchFilterPersist validates sort + time enum values', () => {
	const source = read('lib/modules/searchFilterPersist.js');
	assert.match(source, /VALID_SORT\s*=\s*new Set\(\['relevance', 'new', 'top', 'comments'\]\)/);
	assert.match(source, /VALID_T\s*=\s*new Set\(\['hour', 'day', 'week', 'month', 'year', 'all'\]\)/);
});

test('searchFilterPersist replays saved prefs only when the URL is missing them', () => {
	const source = read('lib/modules/searchFilterPersist.js');
	assert.match(source, /if \(!params\.has\('sort'\) && prefs\.sort\)/);
	assert.match(source, /if \(!params\.has\('t'\) && prefs\.t\)/);
	assert.match(source, /location\.replace\(url\.toString\(\)\)/);
});

test('searchFilterPersist captures both URL-derived and form-submission updates', () => {
	const source = read('lib/modules/searchFilterPersist.js');
	assert.match(source, /captureCurrentFromUrl\(\)/);
	assert.match(source, /captureFormSubmissions\(\)/);
	assert.match(source, /document\.addEventListener\('submit'/);
});

test('searchFilterPersist persists under one stable localStorage key', () => {
	const source = read('lib/modules/searchFilterPersist.js');
	assert.match(source, /STORAGE_KEY\s*=\s*'rsm-search-filter'/);
});

test('searchFilterPersist runs on both /search and /r/<sub>/search routes', () => {
	const source = read('lib/modules/searchFilterPersist.js');
	assert.match(source, /\^\\\/\(r\\\/\[\^\/\]\+\\\/\)\?search\\b/);
});
