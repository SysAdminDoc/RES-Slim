import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-direct-image');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/directImage.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'directImage.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parseDomainList,
	isDirectMediaUrl,
	shouldRewrite,
	normalizeImgurGifv,
} = await import(pathToFileURL(modulePath).href);

test('parseDomainList lowercases, dedupes, falls back to default on empty', () => {
	assert.deepEqual(parseDomainList('I.redd.it, foo.com, i.redd.it'), ['i.redd.it', 'foo.com']);
	const def = parseDomainList('');
	assert.ok(def.includes('i.redd.it'));
	assert.ok(def.includes('i.imgur.com'));
});

test('isDirectMediaUrl recognises common image extensions', () => {
	assert.equal(isDirectMediaUrl('https://i.redd.it/foo.jpg'), true);
	assert.equal(isDirectMediaUrl('https://i.redd.it/foo.JPEG?w=200'), true);
	assert.equal(isDirectMediaUrl('https://i.redd.it/bar.webp#cache'), true);
	assert.equal(isDirectMediaUrl('https://example.com/page.html'), false);
});

test('isDirectMediaUrl handles video opt-in', () => {
	assert.equal(isDirectMediaUrl('https://v.redd.it/x.mp4', true), true);
	assert.equal(isDirectMediaUrl('https://v.redd.it/x.mp4', false), false);
	assert.equal(isDirectMediaUrl('https://imgur.com/abc.gifv', true), true);
	assert.equal(isDirectMediaUrl('https://imgur.com/abc.gifv', false), true, 'gifv normalised to image-like classification');
});

test('shouldRewrite requires both a known host AND a direct-media URL', () => {
	const hosts = ['i.redd.it', 'i.imgur.com'];
	assert.equal(shouldRewrite('i.redd.it', 'https://i.redd.it/x.png', hosts), true);
	assert.equal(shouldRewrite('i.redd.it', 'https://i.redd.it/galleries/x', hosts), false);
	assert.equal(shouldRewrite('example.com', 'https://example.com/x.png', hosts), false);
	assert.equal(shouldRewrite('', '', hosts), false);
});

test('normalizeImgurGifv rewrites .gifv to .mp4', () => {
	assert.equal(normalizeImgurGifv('https://imgur.com/abc.gifv'), 'https://imgur.com/abc.mp4');
	assert.equal(normalizeImgurGifv('https://i.imgur.com/abc.gifv?source=1'), 'https://i.imgur.com/abc.mp4?source=1');
	assert.equal(normalizeImgurGifv('https://i.redd.it/x.png'), 'https://i.redd.it/x.png');
});

test('directImage module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as directImage \} from '\.\/directImage';/);
	assert.match(index, /^\s*directImage,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/directImage.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/directImage'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	assert.match(mod, /data-rsm-direct-image/);
	for (const opt of ['hosts', 'includeVideo', 'openInNewTab', 'mark']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
