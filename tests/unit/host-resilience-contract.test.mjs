import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { codeOnly } from './helpers/loadFlowModule.mjs';

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

test('redgifs builds its embed without calling a retired API', () => {
	const src = codeOnly(read('lib/modules/hosts/redgifs.js'));
	// This used to assert a `catch (error)` fallback around a call to
	// `api.redgifs.com/v1/gfycats/<id>`. That endpoint answers 404 for every id
	// (checked 2026-08-25), so the "fallback" was the only path anything ever
	// took and the request bought a guaranteed failure per expanded link. The
	// handler now builds the fixed-ratio embed directly, so the assertion the old
	// test made is no longer a property this file has.
	assert.doesNotMatch(src, /api\.redgifs\.com/);
	assert.doesNotMatch(src, /\bajax\b/);
	assert.match(src, /fixedRatio: true/);
	// `host-url-shapes-contract` executes `detect` and `handleLink` and proves no
	// request is made; this only keeps the dead endpoint from coming back.
});
