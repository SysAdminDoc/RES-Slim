import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-reddit-api-status');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(read('lib/utils/redditApiStatus.js'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'redditApiStatus.mjs');
fs.writeFileSync(modulePath, stripped);
const { isApiBlockStatus, classifyApiStatus, getStatusFromError, createApiBlockNotifier } =
	await import(pathToFileURL(modulePath).href);

test('isApiBlockStatus flags only 401/403/429', () => {
	assert.equal(isApiBlockStatus(403), true);
	assert.equal(isApiBlockStatus(401), true);
	assert.equal(isApiBlockStatus(429), true);
	assert.equal(isApiBlockStatus(404), false);
	assert.equal(isApiBlockStatus(200), false);
	assert.equal(isApiBlockStatus(undefined), false);
});

test('classifyApiStatus distinguishes rate-limit from forbidden', () => {
	assert.equal(classifyApiStatus(429), 'rateLimited');
	assert.equal(classifyApiStatus(403), 'forbidden');
	assert.equal(classifyApiStatus(401), 'forbidden');
	assert.equal(classifyApiStatus(500), 'other');
});

test('getStatusFromError reads .status and the "status <n>" message convention', () => {
	assert.equal(getStatusFromError({ status: 429 }), 429);
	assert.equal(getStatusFromError(new Error('status 403')), 403);
	assert.equal(getStatusFromError(new Error('boom')), null);
	assert.equal(getStatusFromError(null), null);
});

test('createApiBlockNotifier throttles repeat blocks and ignores non-blocks', () => {
	const fired = [];
	let clock = 0;
	const notify = createApiBlockNotifier({ notify: (kind, status) => fired.push([kind, status]), now: () => clock, throttleMs: 30000 });

	assert.equal(notify(403), true);
	assert.equal(notify(403), false); // throttled inside the window
	clock = 30001;
	assert.equal(notify(429), true); // window elapsed
	assert.equal(notify(404), false); // not a block status, never fires
	assert.deepEqual(fired, [['forbidden', 403], ['rateLimited', 429]]);
});

test('notifications exposes a throttled Reddit-API-block reporter', () => {
	const source = read('lib/modules/notifications.js');
	assert.match(source, /export function notifyRedditApiBlocked/);
	assert.match(source, /createApiBlockNotifier\(/);
	assert.match(source, /i18n\(kind === 'rateLimited' \? 'redditApiRateLimited' : 'redditApiForbidden'/);
});

test('the .json fetch modules report blocked responses instead of failing silently', () => {
	for (const file of [
		'lib/modules/commentTreeExport.js',
		'lib/modules/crosspostMap.js',
		'lib/modules/topCommentsPreview.js',
		'lib/modules/searchGallery.js',
		'lib/modules/galleryZip.js',
		'lib/modules/savedBackup.js',
		'lib/modules/authorContextBadge.js',
		'lib/modules/autoRefreshComments.js',
	]) {
		assert.match(read(file), /notifyRedditApiBlocked\(/, `${file} should call notifyRedditApiBlocked`);
	}
});

test('autoRefreshComments backs off to the max interval on 429', () => {
	const source = read('lib/modules/autoRefreshComments.js');
	assert.match(source, /getStatusFromError\(e\) === 429/);
	assert.match(source, /currentInterval = maxInterval\(\);/);
});
