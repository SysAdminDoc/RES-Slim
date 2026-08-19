import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';

// imgur writes an id four ways, and two of them resolved to `undefined` until
// v0.42.0. Upstream carries the same defect — issues #5610 and #5611, both filed
// 2026-08-08 and both still open there — because this file is inherited verbatim.
//
// The mechanism is one regex shape used twice. A slugged URL puts the id after a
// hyphen, `\w` excludes the hyphen, so the pattern needs two alternatives and
// therefore two capture groups for one value. `galleryHashRe` had both and the
// handler read only the second, so every *bare* gallery id built
// `gallery/undefined`; `albumHashRe` had only the bare alternative, so every
// *slugged* album URL matched nothing at all and fell through to `return false`.
//
// A source assertion cannot see this — `groups[1]` and `groups[2]` are equally
// plausible reads. These tests drive `detect()` and watch the endpoint it builds.

const OK = { data: { id: 'observed', type: 'image/jpeg', link: 'https://i.imgur.com/observed.jpg' } };

async function imgurHost() {
	const { __targetDefault: imgur } = await loadModule('lib/modules/hosts/imgur.js', 'imgur-url-shapes', {
		stubEnvironment: true,
		exportDefault: true,
	});
	// `preferResAlbums` gates the album branch; the shipped default is true and
	// the option object is not wired up under `loadModule`, so supply it.
	imgur.options = { preferResAlbums: { value: true } };
	return imgur;
}

// Runs `detect` and returns every API path the resulting thunk asks for.
async function endpointsFor(imgur, href) {
	const detected = imgur.detect(new URL(href));
	if (!detected) return detected; // false | null — no expando at all
	const seen = [];
	globalThis.__resSlimAjax = async ({ url }) => {
		seen.push(url.replace('https://api.imgur.com/3/', ''));
		return OK;
	};
	try {
		await detected();
	} finally {
		delete globalThis.__resSlimAjax;
	}
	return seen;
}

test('all four imgur id spellings resolve to a real endpoint', async () => {
	const imgur = await imgurHost();

	// Bare gallery: the spelling that built `gallery/undefined`.
	assert.deepEqual(
		await endpointsFor(imgur, 'https://imgur.com/gallery/AbCd123'),
		['gallery/AbCd123'],
		'a bare gallery id must reach the gallery endpoint',
	);

	// Slugged gallery: the spelling that always worked, kept so a fix for the
	// bare form cannot quietly break this one.
	assert.deepEqual(
		await endpointsFor(imgur, 'https://imgur.com/gallery/some-post-title-AbCd123'),
		['gallery/AbCd123'],
	);

	// Bare album.
	assert.deepEqual(
		await endpointsFor(imgur, 'https://imgur.com/a/AbCd123'),
		['album/AbCd123'],
	);

	// Slugged album: imgur's current album URL shape, which matched nothing.
	assert.deepEqual(
		await endpointsFor(imgur, 'https://imgur.com/a/some-post-title-AbCd123'),
		['album/AbCd123'],
		'a slugged album must be detected at all — `\\w` excludes the hyphen',
	);
});

test('no id spelling ever reaches the API as the literal string "undefined"', async () => {
	// The failure this file exists for is not "no expando" — it is a *request*
	// for a resource named undefined, which 404s and reads as a dead imgur link.
	const imgur = await imgurHost();
	for (const href of [
		'https://imgur.com/gallery/AbCd123',
		'https://imgur.com/gallery/some-title-AbCd123',
		'https://imgur.com/a/AbCd123',
		'https://imgur.com/a/some-title-AbCd123',
		'https://m.imgur.com/gallery/AbCd123',
		'https://www.imgur.com/a/AbCd123',
		'https://imgur.com/gallery/AbCd123#2',
		'https://imgur.com/a/AbCd123/',
	]) {
		const endpoints = await endpointsFor(imgur, href);
		assert.ok(Array.isArray(endpoints) && endpoints.length, `${href} produced no request at all`);
		for (const endpoint of endpoints) {
			assert.doesNotMatch(endpoint, /undefined/, `${href} asked imgur for ${endpoint}`);
		}
	}
});

test('a gallery that is no longer a gallery falls back to the album endpoint', async () => {
	// The `.catch` in the gallery branch reuses the same hash. When that hash was
	// undefined both calls were wrong, so the fallback masked the bug by failing
	// twice instead of once.
	const imgur = await imgurHost();
	const detected = imgur.detect(new URL('https://imgur.com/gallery/AbCd123'));
	const seen = [];
	globalThis.__resSlimAjax = async ({ url }) => {
		const endpoint = url.replace('https://api.imgur.com/3/', '');
		seen.push(endpoint);
		if (endpoint.startsWith('gallery/')) throw new Error('404');
		return OK;
	};
	try {
		await detected();
	} finally {
		delete globalThis.__resSlimAjax;
	}
	assert.deepEqual(seen, ['gallery/AbCd123', 'album/AbCd123']);
});

test('imgur service paths are still not treated as media', async () => {
	// The negative lookaheads in `hashRe`. Widening the gallery and album patterns
	// must not make these reachable.
	const imgur = await imgurHost();
	for (const href of [
		'https://imgur.com/removalrequest',
		'https://imgur.com/random',
		'https://imgur.com/memegen',
	]) {
		assert.equal(await endpointsFor(imgur, href), false, `${href} must not expand`);
	}
	for (const pathname of ['/rules', '/inbox']) {
		assert.equal(imgur.detect(new URL(`https://imgur.com${pathname}`)), null);
	}
});

test('direct image links still bypass the API entirely', async () => {
	// `_handleImage`/`_mockImageAPI` answer without a request when the extension
	// is known. Nothing here should have changed that, and it is the path that
	// keeps working without a credential.
	const imgur = await imgurHost();
	globalThis.__resSlimAjax = async () => { throw new Error('a direct image must not hit the API'); };
	try {
		const info = await imgur.detect(new URL('https://i.imgur.com/AbCd123.jpg'))();
		assert.equal(info.id, 'AbCd123');
		assert.equal(info.link, 'https://i.imgur.com/AbCd123.jpg');
	} finally {
		delete globalThis.__resSlimAjax;
	}
});
