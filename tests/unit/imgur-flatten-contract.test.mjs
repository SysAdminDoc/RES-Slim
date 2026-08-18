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
	isHealthyProbe,
	looksLikeMirror,
	originForMirror,
	pickHealthyMirror,
	probeUrlFor,
} = await import(pathToFileURL(modulePath).href);

const moduleSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/imgurFlatten.js'), 'utf8');
const readManifest = target => JSON.parse(fs.readFileSync(path.join(repoRoot, target, 'manifest.json'), 'utf8'));

// A root document as a live rimgo instance actually serves it, trimmed to the
// part the probe judges. Captured from rimgo.reallyaweso.me on 2026-08-18.
const RIMGO_BODY = '<!DOCTYPE html><html><head><title>rimgo</title></head><body><a href="https://codeberg.org/rimgo/rimgo">source</a></body></html>';
// What imgur.artemislena.eu served, with a 200, while shipping as the
// first-choice default.
const CHALLENGE_BODY = '<!DOCTYPE html><html><head><title>Making sure you\'re not a bot!</title></head><body>Checking your browser</body></html>';

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

test('a 200 that is not rimgo is not a healthy mirror', () => {
	// The whole reason this check exists: imgur.artemislena.eu was the
	// first-choice default for months while answering 200 with a bot challenge,
	// so `isHealthyStatus` alone called a page that never returns album HTML
	// healthy. A status code cannot tell those apart; the body can.
	assert.equal(looksLikeMirror(RIMGO_BODY), true);
	assert.equal(looksLikeMirror(CHALLENGE_BODY), false);
	assert.equal(looksLikeMirror('<title>Just a moment...</title>'), false, 'the Cloudflare interstitial');
	assert.equal(looksLikeMirror(''), false);
	assert.equal(looksLikeMirror(null), false);
	// A rebranded title is still recognisable by the source link back to rimgo.
	assert.equal(looksLikeMirror('<title>albums</title><a href="https://codeberg.org/rimgo/rimgo">src</a>'), true);

	assert.equal(isHealthyProbe({ status: 200, body: RIMGO_BODY }), true);
	assert.equal(isHealthyProbe({ status: 200, body: CHALLENGE_BODY }), false);
	assert.equal(isHealthyProbe({ status: 403, body: RIMGO_BODY }), false, 'the body cannot rescue a dead status');
	// Rate-limited: alive, but serving an error page, so there is no body to
	// judge and the status is the only signal there is.
	assert.equal(isHealthyProbe({ status: 429, body: 'slow down' }), true);
	// A bare number is the status-only shape the fallthrough tests inject.
	assert.equal(isHealthyProbe(200), true);
	assert.equal(isHealthyProbe(503), false);
	assert.equal(isHealthyProbe(null), false);
});

test('a mirror that answers 200 with a challenge page falls through to a real one', async () => {
	const tried = [];
	const picked = await pickHealthyMirror(
		['https://challenge.example', 'https://real.example', 'https://never.example'],
		async mirror => {
			tried.push(mirror);
			return mirror.includes('challenge') ?
				{ status: 200, body: CHALLENGE_BODY } :
				{ status: 200, body: RIMGO_BODY };
		},
	);
	assert.equal(picked, 'https://real.example');
	assert.deepEqual(tried, ['https://challenge.example', 'https://real.example']);
});

test('originForMirror yields a match pattern, or nothing it cannot parse', () => {
	assert.equal(originForMirror('https://rimgo.example.com'), 'https://rimgo.example.com/*');
	assert.equal(originForMirror('rimgo.example.com/'), 'https://rimgo.example.com/*');
	assert.equal(originForMirror('http://rimgo.example.com:8080/x'), 'http://rimgo.example.com:8080/*');
	assert.equal(originForMirror(''), '');
	assert.equal(originForMirror(null), '');
	assert.equal(originForMirror('http://['), '', 'an unparseable value must not become a permission request');
});

test('both manifests declare exactly the shipped mirrors as optional origins', () => {
	// Without a host permission the service worker's fetch is CORS-blocked and
	// every mirror reads as dead — which is how this module shipped doing nothing
	// at all. Verified 2026-08-18 against the built extension: the fetch rejects
	// with "Failed to fetch". Unlike Arctic Shift / pullpush / Wayback, rimgo
	// instances send no `Access-Control-Allow-Origin` to work around it.
	const wanted = DEFAULT_MIRRORS.map(m => `${m}/*`).sort();
	const isOrigin = entry => /^https?:\/\//.test(entry);
	const mirrorish = list => list.filter(entry => wanted.includes(entry) || /rimgo|rmgur/i.test(entry)).sort();

	assert.deepEqual(mirrorish(readManifest('chrome').optional_host_permissions), wanted);
	assert.deepEqual(
		mirrorish(readManifest('firefox').optional_permissions.filter(isOrigin)),
		wanted,
		'Firefox MV2 spells this field differently, so a one-sided edit leaves one browser unable to ask',
	);
});

test('the module asks for the mirror host before it probes, and judges the body', () => {
	// A probe that reads only `.status` is the defect this module shipped with,
	// and a probe that runs without the permission never leaves the browser.
	assert.match(moduleSource, /await Permissions\.has\(\[origin\]\)/);
	assert.match(moduleSource, /await Permissions\.request\(\[origin\]\)/);
	assert.match(moduleSource, /if \(!await ensureMirrorPermission\(mirror\)\)/);
	assert.match(moduleSource, /body: response && typeof response\.text === 'string'/);
	assert.doesNotMatch(codeOnly(moduleSource), /pickHealthyMirror\(mirrors, probeStatus\)/);
	// "No permission" and "host is down" have different remedies, so they must not
	// collapse into one message.
	assert.match(moduleSource, /ungranted\.length === mirrors\.length/);
});

test('the module only rewrites once a mirror is known good', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/imgurFlatten.js'), 'utf8');
	// Writing data-url is destructive: the original URL is gone afterwards, so a
	// rewrite through an unchecked mirror cannot be undone by a later pass.
	assert.match(mod, /resolveMirror\(\)\.then\(mirror => \{/);
	assert.match(mod, /if \(mirror && el\.isConnected\) applyRewrite/);
	// One toast, and only when every mirror is unusable — a single dead instance
	// is a non-event. Asserted as intent rather than one spelling: the guard has
	// already moved once, and pinning the line is how a contract fails a refactor
	// that kept the behaviour.
	assert.match(mod, /if \(!mirror\) reportNoMirror\(mirrors\)/);
	assert.match(mod, /if \(allMirrorsFailed\) return;\n\tallMirrorsFailed = true;/);
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
