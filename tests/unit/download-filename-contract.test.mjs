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

test('a very long title is capped in bytes, not characters', () => {
	// The cap has to be a byte budget: 255 bytes is the filesystem ceiling and a
	// Japanese or Cyrillic character is two or three of them, so a 180-character
	// count let a 500-byte name through. The first version of this test measured
	// `'x'.repeat(400)` and asserted a character count, which is exactly the
	// wrong unit and could not see it.
	const bytes = value => new TextEncoder().encode(value).length;
	const JA = String.fromCodePoint(0x65e5);
	const CY = String.fromCodePoint(0x043f);

	for (const title of ['x'.repeat(400), JA.repeat(400), CY.repeat(400), JA.repeat(100) + 'a'.repeat(200)]) {
		const name = downloadFilename(title, 'https://i.redd.it/a.png');
		assert.ok(bytes(name) <= 200, `expected a byte-capped name, got ${bytes(name)} bytes`);
		assert.ok(name.endsWith('.png'));
	}

	// And the URL fallback, which had no cap at all.
	const longPath = `https://i.redd.it/${'y'.repeat(500)}.png`;
	assert.ok(bytes(basenameFor(longPath)) <= 220, 'the URL fallback must be capped too');
});

test('a truncated name never ends inside a character', () => {
	// `String.prototype.slice` is UTF-16 code-unit based, so cutting a title of
	// astral characters at a fixed index can leave half a surrogate pair.
	const astral = String.fromCodePoint(0x20000).repeat(200);
	const stem = stemFromTitle(astral);
	if (stem) {
		const lone = new RegExp(`[${String.fromCharCode(0xD800)}-${String.fromCharCode(0xDBFF)}](?![${String.fromCharCode(0xDC00)}-${String.fromCharCode(0xDFFF)}])`, 'u');
		assert.equal(lone.test(stem), false, 'a lone surrogate survived the truncation');
	}
});

test('a reserved Windows device name is not produced', () => {
	// `CON`, `NUL`, `COM1` and friends are refused with or without an extension.
	// Chrome sanitizes what it is handed, but the URL fallback builds a name from
	// a path and nothing else guarded it.
	for (const reserved of ['CON', 'nul', 'Com1', 'LPT9', 'prn', 'aux']) {
		const fromTitle = downloadFilename(reserved, 'https://i.redd.it/a.png');
		assert.notEqual(fromTitle.replace(/\.png$/, '').toLowerCase(), reserved.toLowerCase(),
			`${reserved} survived as a filename`);
		const fromUrl = basenameFor(`https://i.redd.it/${reserved}`);
		assert.notEqual(fromUrl.toLowerCase(), reserved.toLowerCase(), `${reserved} survived from the URL`);
	}
	// An ordinary name that merely starts with those letters is untouched.
	assert.equal(downloadFilename('console log', 'https://i.redd.it/a.png'), 'console log.png');
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
