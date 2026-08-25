// Filenames for downloaded media, executed rather than pattern-matched.
//
// The expando's download control built its filename inline, and each of the
// cases below was a real failure a normal reddit post produces:
//
//   * a URL with no file extension made the extension `undefined`, and the very
//     next line called `.includes('?')` on it. The TypeError was swallowed by the
//     handler's `.catch`, so the user got "Could not start the download. Check
//     the downloads permission" for a link that had nothing wrong with its
//     permission.
//   * an emoji-only title survived a truthiness check, then reduced to the empty
//     string, and the download was named `.jpg` - a dotfile.
//   * the strip range deleted CJK punctuation, so a Japanese title came out in
//     pieces.
//
// Every one of those is invisible to a source-shape assertion, so this file runs
// the helper.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const { downloadFilename, extensionFor, basenameFor, stemFromTitle, DEFAULT_STEM } =
	await loadFlowModule('lib/utils/downloadFilename.js', 'download-filename');

test('the extension comes from the path, not from the query string', () => {
	assert.equal(extensionFor('https://i.redd.it/abc.jpg'), 'jpg');
	// preview.redd.it signs every URL, so this is the ordinary case.
	assert.equal(extensionFor('https://preview.redd.it/a.png?auto=webp&s=deadbeef'), 'png');
	// A dot in the query is not an extension.
	assert.equal(extensionFor('https://example.invalid/image?v=1.2'), null);
	assert.equal(extensionFor('https://example.invalid/image'), null);
	assert.equal(extensionFor(null), null);
	assert.equal(extensionFor('not a url at all'), null);
});

test('a URL with no extension produces a usable name instead of throwing', () => {
	// The old inline code threw a TypeError here and the user saw a permission
	// error for a download that had no permission problem.
	assert.equal(downloadFilename('My cool post', 'https://i.redd.it/abc'), 'My cool post');
	assert.equal(downloadFilename(null, 'https://i.redd.it/abc'), 'abc');
});

test('a title that is nothing but emoji falls back to the URL, never to a dotfile', () => {
	const emojiOnly = `${String.fromCodePoint(0x1f600)}${String.fromCodePoint(0x1f601)}`;
	const name = downloadFilename(emojiOnly, 'https://i.redd.it/abc.jpg');
	assert.equal(name, 'abc.jpg');
	assert.ok(!name.startsWith('.'), 'a leading dot makes the file hidden and the save silently useless');
	assert.equal(stemFromTitle(emojiOnly), null);
});

test('emoji are removed from a title that still has words in it', () => {
	assert.equal(
		downloadFilename(`sunset ${String.fromCodePoint(0x1f305)} tonight`, 'https://i.redd.it/a.png'),
		'sunset tonight.png',
	);
});

test('non-Latin titles survive intact', () => {
	// The inherited strip range was U+2000-U+3300, which takes CJK punctuation
	// and kana with it.
	assert.equal(downloadFilename('日本語のタイトル、テスト', 'https://i.redd.it/a.png'), '日本語のタイトル、テスト.png');
	assert.equal(downloadFilename('Привет мир', 'https://i.redd.it/a.png'), 'Привет мир.png');
	assert.equal(downloadFilename('café', 'https://i.redd.it/a.png'), 'café.png');
});

test('reserved and control characters are removed', () => {
	const reserved = `a/b${String.fromCharCode(92)}c:d*e?f<g>h|i"j`;
	assert.equal(downloadFilename(reserved, 'https://i.redd.it/a.png'), 'abcdefghij.png');
	assert.equal(stemFromTitle(`tab${String.fromCharCode(9)}here`), 'tabhere');
});

test('a very long title is capped below the filesystem limit', () => {
	const name = downloadFilename('x'.repeat(400), 'https://i.redd.it/a.png');
	assert.ok(name.length <= 200, `expected a capped name, got ${name.length} characters`);
	assert.ok(name.endsWith('.png'));
});

test('leading and trailing dots and spaces are trimmed', () => {
	assert.equal(downloadFilename('...hidden', 'https://i.redd.it/a.png'), 'hidden.png');
	assert.equal(downloadFilename('trailing.  ', 'https://i.redd.it/a.png'), 'trailing.png');
	// A title that collapses to dots alone is not a name.
	assert.equal(stemFromTitle('...'), null);
	assert.equal(stemFromTitle('   '), null);
});

test('the URL fallback never returns a directory reference or an empty string', () => {
	assert.equal(basenameFor('https://example.invalid/'), DEFAULT_STEM);
	assert.equal(basenameFor('https://example.invalid/..'), DEFAULT_STEM);
	assert.equal(basenameFor(''), DEFAULT_STEM);
	assert.equal(basenameFor('nonsense'), 'nonsense');
	assert.equal(basenameFor('https://example.invalid/dir/file name.jpg'), 'file_name.jpg');
});
