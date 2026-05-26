import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('topCommentsPreview is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as topCommentsPreview \} from '\.\/topCommentsPreview';/);
	assert.match(index, /^\s*topCommentsPreview,/m);
});

test('topCommentsPreview hits the comments JSON endpoint with depth + limit pinned', () => {
	const source = read('lib/modules/topCommentsPreview.js');
	assert.match(source, /\.json\?raw_json=1&sort=top&depth=1&limit=\$\{count\}/);
	assert.match(source, /Accept: 'application\/json'/);
});

test('topCommentsPreview caches by permalink + count and rate-limits outbound fetches', () => {
	const source = read('lib/modules/topCommentsPreview.js');
	assert.match(source, /createRateLimiter\(\{ tokens: 4, refillMs: 1000, maxConcurrent: 4 \}\)/);
	assert.match(source, /cache: Map<string, string>/);
	assert.match(source, /const cacheKey = `\$\{permalink\}::\$\{count\}`/);
});

test('topCommentsPreview only renders on listing and profile surfaces', () => {
	const source = read('lib/modules/topCommentsPreview.js');
	assert.match(source, /module\.include\s*=\s*\['linklist', 'profile'\]/);
});

test('topCommentsPreview caps the per-post comment count at 10', () => {
	const source = read('lib/modules/topCommentsPreview.js');
	assert.match(source, /Math\.min\(10, Math\.floor\(raw\)\)/);
});

test('topCommentsPreview sanitizes Reddit comment HTML before insertion', () => {
	const source = read('lib/modules/topCommentsPreview.js');
	assert.match(source, /import DOMPurify from 'dompurify'/);
	assert.match(source, /function safeCommentBodyHtml/);
	assert.match(source, /DOMPurify\.sanitize\(html\)/);
	assert.match(source, /escapeHTML\(c\.author \|\| '\[deleted\]'\)/);
});

test('rateLimiter token-bucket helper exposes schedule + pending', async () => {
	const limiterSource = fs.readFileSync(path.join(repoRoot, 'lib/utils/rateLimiter.js'), 'utf8');
	const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-limiter');
	fs.mkdirSync(tmpDir, { recursive: true });
	const stripped = flowRemoveTypes(limiterSource, { all: true }).toString();
	const modulePath = path.join(tmpDir, 'limiter.mjs');
	fs.writeFileSync(modulePath, stripped);
	const { createRateLimiter } = await import(pathToFileURL(modulePath).href);

	const limiter = createRateLimiter({ tokens: 1, refillMs: 50, maxConcurrent: 1 });
	const order = [];
	const results = await Promise.all([
		limiter.schedule(async () => { order.push('a'); return 1; }),
		limiter.schedule(async () => { order.push('b'); return 2; }),
		limiter.schedule(async () => { order.push('c'); return 3; }),
	]);
	assert.deepEqual(results, [1, 2, 3]);
	assert.deepEqual(order, ['a', 'b', 'c']);
});
