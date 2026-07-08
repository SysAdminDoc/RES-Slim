import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-repost-dedupe');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(read('lib/utils/repostDedupe.js'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'repostDedupe.mjs');
fs.writeFileSync(modulePath, stripped);
const { normalizePostKey, thumbnailKey, createSeenTracker } = await import(pathToFileURL(modulePath).href);

test('normalizePostKey collapses i.redd.it / preview.redd.it variants of one upload', () => {
	const a = normalizePostKey('https://i.redd.it/abc123.jpg');
	const b = normalizePostKey('https://preview.redd.it/abc123.png?width=640&crop=smart');
	assert.equal(a, 'redd:abc123');
	assert.equal(a, b);
});

test('normalizePostKey collapses imgur permutations and strips query/trailing slash', () => {
	assert.equal(normalizePostKey('https://i.imgur.com/XyZ.gifv'), 'imgur:XyZ');
	assert.equal(normalizePostKey('https://example.com/page/?utm=1'), 'url:example.com/page');
	assert.equal(normalizePostKey('https://www.example.com/page/'), 'url:example.com/page');
});

test('normalizePostKey skips self/comment permalinks and junk', () => {
	assert.equal(normalizePostKey('https://old.reddit.com/r/x/comments/1/title/'), null);
	assert.equal(normalizePostKey(''), null);
	assert.equal(normalizePostKey('javascript:alert(1)'), null);
});

test('thumbnailKey ignores reddit placeholder thumbnails', () => {
	assert.equal(thumbnailKey('self'), null);
	assert.equal(thumbnailKey('default'), null);
	assert.equal(thumbnailKey('nsfw'), null);
	assert.equal(thumbnailKey('https://b.thumbs.redditmedia.com/x.jpg'), 'url:b.thumbs.redditmedia.com/x.jpg');
});

test('createSeenTracker reports first vs repeat appearances', () => {
	const t = createSeenTracker();
	assert.equal(t.seen('k1'), false);
	assert.equal(t.seen('k1'), true);
	assert.equal(t.seen('k2'), false);
	assert.equal(t.size(), 2);
});

test('repostDedupe module is registered, disabled by default, styled', () => {
	const mod = read('lib/modules/repostDedupe.js');
	assert.match(mod, /module\.disabledByDefault = true;/);
	assert.match(mod, /createSeenTracker\(\)/);
	assert.match(mod, /tracker\.seen\(key\)/);

	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as repostDedupe \} from '\.\/repostDedupe';/);
	assert.match(index, /^\s*repostDedupe,/m);
	assert.match(read('lib/css/res.scss'), /@import 'modules\/repostDedupe';/);
});
