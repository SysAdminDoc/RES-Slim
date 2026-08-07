import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';
import { codeOnly } from './helpers/loadFlowModule.mjs';

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
	DEFAULT_MIRRORS,
	DEFAULT_MIRROR,
	DEFAULT_MIRROR_LIST,
	parseMirrorList,
	isHealthyStatus,
	pickHealthyMirror,
	probeUrlFor,
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

test('the dead default is gone', () => {
	// ri.bcow.xyz returned 403 when probed on 2026-08-07, and
	// rimgo.totaldarkness.net returned 502 before it. A single static default is
	// the wrong shape for a third-party host this fork does not control.
	const util = fs.readFileSync(path.join(repoRoot, 'lib/utils/imgurFlatten.js'), 'utf8');
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/imgurFlatten.js'), 'utf8');
	// The header documents both deaths on purpose, so the check runs against
	// comment-stripped code — otherwise it fails on its own explanation.
	const code = codeOnly(mod);
	assert.match(mod, /ri\.bcow\.xyz/, 'the header should still record what died');
	assert.doesNotMatch(code, /ri\.bcow\.xyz|totaldarkness/);
	assert.ok(DEFAULT_MIRRORS.length >= 2, 'a list, not a single point of failure');
	// rimgo.privacyredirect.com appears on several published instance lists and
	// did not resolve at all when probed; re-adding it repeats the bug.
	assert.match(util, /privacyredirect/, 'the header should still record the host that did not resolve');
	assert.doesNotMatch(codeOnly(util), /privacyredirect/);
});

test('parseMirrorList splits, dedupes, and never yields an empty list', () => {
	assert.deepEqual(parseMirrorList(''), DEFAULT_MIRRORS);
	assert.deepEqual(parseMirrorList(null), DEFAULT_MIRRORS);
	assert.deepEqual(parseMirrorList('  , \n '), DEFAULT_MIRRORS);
	assert.deepEqual(
		parseMirrorList('a.example.com, https://b.example.com\nb.example.com/'),
		['https://a.example.com', 'https://b.example.com'],
	);
	// Order is preference order and must survive a round trip.
	assert.deepEqual(parseMirrorList(DEFAULT_MIRROR_LIST), DEFAULT_MIRRORS);
	assert.equal(DEFAULT_MIRROR, DEFAULT_MIRRORS[0]);
});

test('a rate-limited mirror counts as alive', () => {
	// 429 means the host is up and the next request may well succeed. Treating it
	// as dead rotates away from a working mirror on one busy moment.
	assert.equal(isHealthyStatus(429), true);
	assert.equal(isHealthyStatus(200), true);
	assert.equal(isHealthyStatus(301), true);
	assert.equal(isHealthyStatus(403), false, 'the exact status the old default started returning');
	assert.equal(isHealthyStatus(404), false);
	assert.equal(isHealthyStatus(502), false);
	assert.equal(isHealthyStatus(0), false);
	assert.equal(isHealthyStatus(null), false);
	assert.equal(isHealthyStatus('200'), false);
	assert.equal(isHealthyStatus(NaN), false);
});

test('a dead mirror falls through to the next one', async () => {
	const tried = [];
	const probe = async mirror => {
		tried.push(mirror);
		if (mirror.includes('dead')) return 403;
		if (mirror.includes('gone')) throw new Error('ENOTFOUND');
		return 200;
	};
	const picked = await pickHealthyMirror(
		['https://dead.example', 'https://gone.example', 'https://live.example', 'https://never.example'],
		probe,
	);
	assert.equal(picked, 'https://live.example');
	// Stops at the first healthy one rather than probing the whole list.
	assert.deepEqual(tried, ['https://dead.example', 'https://gone.example', 'https://live.example']);
});

test('every mirror failing resolves to null rather than a bad rewrite', async () => {
	const picked = await pickHealthyMirror(['https://a.example', 'https://b.example'], async () => 503);
	assert.equal(picked, null);
	// A transport failure counts as failure, not as a crash.
	const thrown = await pickHealthyMirror(['https://a.example'], async () => { throw new Error('offline'); });
	assert.equal(thrown, null);
});

test('the module only rewrites once a mirror is known good', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/imgurFlatten.js'), 'utf8');
	// Writing data-url is destructive: the original URL is gone afterwards, so a
	// rewrite through an unchecked mirror cannot be undone by a later pass.
	assert.match(mod, /resolveMirror\(\)\.then\(mirror => \{/);
	assert.match(mod, /if \(mirror && el\.isConnected\) applyRewrite/);
	// One toast, and only when every mirror is down.
	assert.match(mod, /if \(!mirror && !allMirrorsFailed\)/);
});

test('probeUrlFor targets the mirror root', () => {
	assert.equal(probeUrlFor('https://m.example'), 'https://m.example/');
	assert.equal(probeUrlFor('https://m.example/'), 'https://m.example/');
	assert.equal(probeUrlFor('m.example'), 'https://m.example/');
});

test('sanitizeMirror falls back to the default, normalises scheme + trailing slash', () => {
	assert.equal(sanitizeMirror(''), DEFAULT_MIRROR);
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
