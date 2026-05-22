import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-imgur-flatten');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/imgurFlatten.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'imgurFlatten.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	isImgurAlbumUrl,
	extractAlbumId,
	sanitizeMirror,
	rewriteAlbumUrl,
	rewriteImageUrl,
} = await import(pathToFileURL(modulePath).href);

test('isImgurAlbumUrl recognises /a/ and /gallery/ variants', () => {
	assert.equal(isImgurAlbumUrl('https://imgur.com/a/abc123'), true);
	assert.equal(isImgurAlbumUrl('https://imgur.com/gallery/Xyz9'), true);
	assert.equal(isImgurAlbumUrl('https://www.imgur.com/a/abc'), true);
	assert.equal(isImgurAlbumUrl('https://m.imgur.com/a/abc'), true);
	assert.equal(isImgurAlbumUrl('https://i.imgur.com/abc.jpg'), false);
	assert.equal(isImgurAlbumUrl('https://imgur.com/abc'), false);
	assert.equal(isImgurAlbumUrl(null), false);
});

test('extractAlbumId returns the bare id', () => {
	assert.equal(extractAlbumId('https://imgur.com/a/abc123'), 'abc123');
	assert.equal(extractAlbumId('https://imgur.com/gallery/Xyz9?foo'), 'Xyz9');
	assert.equal(extractAlbumId('https://i.imgur.com/abc.jpg'), '');
});

test('sanitizeMirror falls back to the default, normalises scheme + trailing slash', () => {
	assert.equal(sanitizeMirror(''), 'https://rimgo.totaldarkness.net');
	assert.equal(sanitizeMirror('rimgo.example.com/'), 'https://rimgo.example.com');
	assert.equal(sanitizeMirror('http://rimgo.example.com//'), 'http://rimgo.example.com');
});

test('rewriteAlbumUrl swaps the host while preserving the id', () => {
	assert.equal(
		rewriteAlbumUrl('https://imgur.com/a/abc123', 'https://rimgo.example.com'),
		'https://rimgo.example.com/a/abc123',
	);
	assert.equal(
		rewriteAlbumUrl('https://imgur.com/gallery/abc', 'https://rimgo.example.com/'),
		'https://rimgo.example.com/a/abc',
	);
	assert.equal(rewriteAlbumUrl('https://example.com/page', 'https://rimgo.example.com'), 'https://example.com/page');
});

test('rewriteImageUrl swaps the i.imgur.com host only', () => {
	assert.equal(
		rewriteImageUrl('https://i.imgur.com/abc.jpg', 'https://rimgo.example.com'),
		'https://rimgo.example.com/abc.jpg',
	);
	assert.equal(rewriteImageUrl('https://example.com/x.jpg', 'https://rimgo.example.com'), 'https://example.com/x.jpg');
});

test('imgurFlatten module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as imgurFlatten \} from '\.\/imgurFlatten';/);
	assert.match(index, /^\s*imgurFlatten,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/imgurFlatten.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/imgurFlatten'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	for (const opt of ['mirror', 'rewriteTitle', 'rewriteData']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
