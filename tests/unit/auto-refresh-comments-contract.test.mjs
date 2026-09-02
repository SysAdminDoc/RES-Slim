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
	assert.match(source, /\.json\?raw_json=1&sort=new&depth=10&limit=200/);
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

test('autoRefreshComments surfaces live status for paused, checking, success, and retry states', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /const STATUS_ID = 'RSMAutoRefreshCommentsStatus'/);
	assert.match(source, /setAttribute\('role', 'status'\)/);
	assert.match(source, /setAttribute\('aria-live', 'polite'\)/);
	assert.match(source, /setStatus\('Checking for new comments\.\.\.', 'checking'\)/);
	assert.match(source, /setStatus\(`Added \$\{added\} new comment/);
	assert.match(source, /setStatus\(`Refresh failed\. Retrying in/);
	assert.match(source, /setAttribute\('aria-describedby', STATUS_ID\)/);
});

test('autoRefreshComments CSS partial is wired into res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.match(res, /@use 'modules\/autoRefreshComments';/);
});

test('autoRefreshComments SCSS styles the status companion and focus states', () => {
	const scss = read('lib/css/modules/_autoRefreshComments.scss');
	assert.match(scss, /\.rsm-auto-refresh-host/);
	assert.match(scss, /\.rsm-auto-refresh-status/);
	assert.match(scss, /\[data-state='checking'\]/);
	assert.match(scss, /\[data-state='success'\]/);
	assert.match(scss, /\[data-state='error'\]/);
	// Reduced motion is honoured once for every rsm- surface in the token layer
	// rather than re-declared per module.
	assert.match(read('lib/css/_tokens.scss'), /prefers-reduced-motion: reduce/);
});

test('autoRefreshComments sanitizes newly fetched comment HTML', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /import DOMPurify from 'dompurify'/);
	assert.match(source, /function safeCommentBodyHtml/);
	assert.match(source, /DOMPurify\.sanitize\(html\)/);
	assert.match(source, /escapeHTML\(d\.author \|\| '\[deleted\]'\)/);
});
