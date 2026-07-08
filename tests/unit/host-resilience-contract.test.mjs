import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('streamable handler bails cleanly when a video has no playable file', () => {
	const src = read('lib/modules/hosts/streamable.js');
	// No blind destructure of files.mp4.url (would TypeError on a deleted/processing video).
	assert.doesNotMatch(src, /files:\s*\{\s*mp4:\s*\{\s*url\s*\}\s*\}/);
	assert.match(src, /data\.files\.mp4\.url/);
	assert.match(src, /if \(!url\) throw new Error/);
});

test('redditgallery handler skips items with missing media type instead of crashing', () => {
	const src = read('lib/modules/hosts/redditgallery.js');
	assert.match(src, /if \(typeof m !== 'string'\) return undefined;/);
});

test('redgifs handler degrades to a fixed-ratio embed on API failure', () => {
	const src = read('lib/modules/hosts/redgifs.js');
	// The v1 metadata API is deprecated; the catch fallback must still yield an embed.
	assert.match(src, /catch \(error\)/);
	assert.match(src, /fixedRatio: true/);
});
