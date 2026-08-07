import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const ris = await loadFlowModule('lib/utils/reverseImageSearch.js', 'reverse-image-search');
const mod = readRepoFile('lib/modules/reverseImageSearch.js');

test('every engine produces an absolute https URL with the image encoded', () => {
	const image = 'https://i.redd.it/abc def&x=1.jpg';
	const results = ris.reverseSearchUrls(image, ris.ENGINE_IDS);
	assert.equal(results.length, ris.ENGINES.length);

	for (const result of results) {
		const parsed = new URL(result.url);
		assert.equal(parsed.protocol, 'https:');
		// The raw URL must never appear unencoded — a literal `&` would truncate
		// the engine's query and silently search for the wrong thing.
		assert.doesNotMatch(result.url, /i\.redd\.it\/abc def/);
		assert.match(result.url, /abc%20def%26x%3D1/);
	}
});

test('only the requested engines are returned, in a stable order', () => {
	const results = ris.reverseSearchUrls('https://i.redd.it/a.jpg', ['tineye', 'lens']);
	assert.deepEqual(results.map(r => r.id), ['lens', 'tineye']);

	assert.deepEqual(ris.reverseSearchUrls('https://i.redd.it/a.jpg', []), []);
	assert.deepEqual(ris.reverseSearchUrls('https://i.redd.it/a.jpg', ['nope']), []);
});

test('an image the engine cannot fetch produces no buttons at all', () => {
	// A relative path, a blob: or a data: URL all produce an engine page that
	// errors after the user has already left reddit. Better to render nothing.
	assert.equal(ris.isSearchableImageUrl('/img/a.jpg'), false);
	assert.equal(ris.isSearchableImageUrl('data:image/png;base64,AAA'), false);
	assert.equal(ris.isSearchableImageUrl('blob:https://reddit.com/x'), false);
	assert.equal(ris.isSearchableImageUrl('https://i.redd.it'), false, 'a bare host is not an image');
	assert.equal(ris.isSearchableImageUrl(''), false);
	assert.equal(ris.isSearchableImageUrl(null), false);
	assert.equal(ris.isSearchableImageUrl('https://i.redd.it/a.jpg'), true);
	assert.equal(ris.isSearchableImageUrl('http://example.com/a.png'), true);

	assert.deepEqual(ris.reverseSearchUrls('data:image/png;base64,AAA'), []);
});

test('the post link is preferred over the downscaled thumbnail', () => {
	// old.reddit thumbnails are ~70px proxies; searching one finds nothing, which
	// is the top complaint about the userscripts in this space.
	assert.equal(
		ris.bestImageUrlFor('https://i.redd.it/full.jpg', 'https://b.thumbs.redditmedia.com/tiny.jpg'),
		'https://i.redd.it/full.jpg');
	// Extensionless reddit-hosted media is still an image.
	assert.equal(
		ris.bestImageUrlFor('https://preview.redd.it/abcdef', 'https://b.thumbs.redditmedia.com/tiny.jpg'),
		'https://preview.redd.it/abcdef');
	// A text post falls back to whatever thumbnail exists.
	assert.equal(
		ris.bestImageUrlFor('https://old.reddit.com/r/aww/comments/x/', 'https://b.thumbs.redditmedia.com/tiny.jpg'),
		'https://b.thumbs.redditmedia.com/tiny.jpg');
	// Nothing usable at all.
	assert.equal(ris.bestImageUrlFor('https://old.reddit.com/r/aww/comments/x/', 'self'), null);
	assert.equal(ris.bestImageUrlFor(null, null), null);
});

test('the module opens engines in a new tab without leaking the opener', () => {
	assert.match(mod, /rel = 'noopener noreferrer'/);
	assert.match(mod, /target = '_blank'/);
	assert.match(mod, /module\.disabledByDefault = true/);
});

test('no engine is contacted by the extension itself', () => {
	// The whole privacy argument for this module is that it only builds links.
	assert.doesNotMatch(mod, /\bfetch\(|\bajax\(|XMLHttpRequest/);
	assert.doesNotMatch(readRepoFile('lib/utils/reverseImageSearch.js'), /\bfetch\(|\bajax\(|XMLHttpRequest/);
});
