import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('autoRefreshComments is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as autoRefreshComments \} from '\.\/autoRefreshComments';/);
	assert.match(index, /^\s*autoRefreshComments,/m);
});

test('autoRefreshComments fetches the thread JSON sorted by new through the rate limiter', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /createRateLimiter/);
	assert.match(source, /\.json\?sort=new&depth=10&limit=200/);
});

test('autoRefreshComments dedupes by data-fullname before splicing new entries', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /\.commentarea \.thing\.comment\[data-fullname\]/);
	assert.match(source, /!known\.has\(c\.data\.name\)/);
});

test('autoRefreshComments applies exponential backoff capped at the configured maximum', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /currentInterval = Math\.min\(maxInterval\(\), Math\.max\(startInterval\(\), currentInterval \* 2 \|\| startInterval\(\)\)\)/);
});

test('autoRefreshComments resets the interval to the start value when a poll succeeds', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /currentInterval = startInterval\(\);/);
});

test('autoRefreshComments only runs on /comments/ pages and ships an on/off toggle', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /location\.pathname\.includes\('\/comments\/'\)/);
	assert.match(source, /module\.include\s*=\s*\['comments'\]/);
	assert.match(source, /aria-pressed/);
});

test('autoRefreshComments CSS partial is wired into res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.match(res, /@import 'modules\/autoRefreshComments';/);
});
