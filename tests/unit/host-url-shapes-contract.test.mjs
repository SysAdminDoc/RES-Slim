// Two inherited `detect()` regexes that quietly matched the wrong thing.
//
// strawpoll.com serves the same poll at `/<id>`, `/polls/<id>` and
// `/embed/<id>`. The pattern only knew `embed/`, so a `/polls/abc123` link
// captured the literal first segment and the expando embedded a poll called
// "polls". Upstream #5448 reports it; the patch was never merged there.
//
// redgifs only knew `/watch/` and `/ifr/`, so the `/i/` short link - which is
// what `old.reddit.com/domain/i.redgifs.com` is full of - got no expando button
// at all. The same handler also called `api.redgifs.com/v1/gfycats/<id>` for
// dimensions. That API was retired and answers 404 for every id (checked
// 2026-08-25; v2 answers 401, so the route exists and v1 does not), which meant
// one guaranteed-failing request per expanded link before the catch block
// produced the fixed-ratio embed it now builds directly.
//
// These run `detect` and `handleLink` rather than reading the source, because a
// regex is exactly the thing a source assertion cannot evaluate.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';

async function host(file, label) {
	const { __targetDefault } = await loadModule(file, label, {
		stubEnvironment: true,
		exportDefault: true,
	});
	return __targetDefault;
}

const strawpoll = await host('lib/modules/hosts/strawpollcom.js', 'strawpoll-url-shapes');
const redgifs = await host('lib/modules/hosts/redgifs.js', 'redgifs-url-shapes');
const soundcloud = await host('lib/modules/hosts/soundcloud.js', 'soundcloud-url-shapes');

function embedFor(site, href) {
	const detected = site.detect(new URL(href));
	if (!detected) return null;
	return site.handleLink(href, detected);
}

test('every strawpoll URL shape embeds the poll the link points at', () => {
	assert.equal(embedFor(strawpoll, 'https://strawpoll.com/abc123').embed, 'https://strawpoll.com/embed/abc123');
	assert.equal(embedFor(strawpoll, 'https://strawpoll.com/embed/abc123').embed, 'https://strawpoll.com/embed/abc123');
	// The reported one: this used to embed `https://strawpoll.com/embed/polls`.
	assert.equal(embedFor(strawpoll, 'https://strawpoll.com/polls/abc123').embed, 'https://strawpoll.com/embed/abc123');
});

test('strawpoll leaves a URL with no id alone', () => {
	assert.equal(strawpoll.detect(new URL('https://strawpoll.com/')), null);
});

test('redgifs recognises the share link as well as the watch and embed pages', () => {
	for (const href of [
		'https://www.redgifs.com/watch/somegifname',
		'https://redgifs.com/ifr/somegifname',
		'https://www.redgifs.com/i/somegifname',
		'https://i.redgifs.com/i/somegifname',
	]) {
		const media = embedFor(redgifs, href);
		assert.ok(media, `${href} should produce an expando`);
		assert.equal(media.type, 'IFRAME');
		assert.equal(media.embedAutoplay, 'https://redgifs.com/ifr/somegifname');
		assert.equal(media.embed, 'https://redgifs.com/ifr/somegifname?autoplay=0');
	}
});

test('redgifs leaves a bare host and an unknown route alone', () => {
	assert.equal(redgifs.detect(new URL('https://www.redgifs.com/')), null);
	assert.equal(redgifs.detect(new URL('https://www.redgifs.com/users/someone')), null);
});

test('redgifs makes no request to build an embed', async () => {
	// A dead endpoint that can only ever throw is latency, not a fallback.
	let requested = 0;
	globalThis.__resSlimAjax = () => { requested++; return Promise.resolve({}); };
	try {
		const media = await embedFor(redgifs, 'https://www.redgifs.com/watch/somegifname');
		assert.equal(media.fixedRatio, true);
		assert.equal(media.muted, true);
	} finally {
		delete globalThis.__resSlimAjax;
	}
	assert.equal(requested, 0, 'the retired v1 metadata API must not be called');
});

// soundcloud's `detect` was `() => true`, so every soundcloud.com URL got an
// expando - including the site's own navigation, where the widget answers with
// an error panel. The button existed only to produce one. Upstream #5568.
test('soundcloud expands a track and a set', () => {
	for (const href of [
		'https://soundcloud.com/forss/flickermood',
		'https://soundcloud.com/forss/sets/soulhack',
		'https://on.soundcloud.com/abc123',
		// A private track's share link carries a secret token. These played before
		// this handler had a detect at all, so narrowing it must not drop them.
		'https://soundcloud.com/forss/flickermood/s-a1B2c3D',
		'https://soundcloud.com/forss/sets/soulhack/s-a1B2c3D',
	]) {
		assert.ok(soundcloud.detect(new URL(href)), `${href} should expand`);
	}
});

test('soundcloud leaves the site\'s own pages and a bare profile alone', () => {
	for (const href of [
		'https://soundcloud.com/',
		'https://soundcloud.com/discover',
		'https://soundcloud.com/search?q=x',
		'https://soundcloud.com/stream',
		'https://soundcloud.com/you/likes',
		'https://soundcloud.com/forss',
		'https://soundcloud.com/forss/flickermood/comments/12345',
		// An artist's own sub-pages are two segments, exactly like a track, so
		// counting segments is not enough on its own.
		'https://soundcloud.com/forss/likes',
		'https://soundcloud.com/forss/tracks',
		'https://soundcloud.com/forss/albums',
		'https://soundcloud.com/forss/reposts',
		'https://soundcloud.com/forss/followers',
	]) {
		assert.equal(Boolean(soundcloud.detect(new URL(href))), false, `${href} should be left alone`);
	}
});

// A third inherited pattern with the same shape of defect. The id class was
// `[a-zA-z0-9]` - lowercase z - and `A-z` spans the six ASCII characters between
// Z and a, so `[`, `\`, `]`, `^`, `_` and a backtick all passed as part of a
// Spotify id and built an embed URI that cannot play. The username was `\w+`,
// which is the opposite mistake: real accounts carry dots and hyphens that it
// refused.
const spotify = await host('lib/modules/hosts/spotify.js', 'spotify-url-shapes');

test('every spotify URL shape embeds what the link points at', () => {
	assert.equal(embedFor(spotify, 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6').embed,
		'https://embed.spotify.com/?uri=spotify:track:6rqhFgbbKwnb9MLmUQDhG6');
	assert.equal(embedFor(spotify, 'https://play.spotify.com/album/1DFixLWuPkv3KT3TnV35m3').embed,
		'https://embed.spotify.com/?uri=spotify:album:1DFixLWuPkv3KT3TnV35m3');
	// The username segment: a dot and a hyphen are both valid and were refused.
	assert.equal(embedFor(spotify, 'https://open.spotify.com/user/some.user-99/playlist/37i9dQZF1DX').embed,
		'https://embed.spotify.com/?uri=spotify:user:some.user-99:playlist:37i9dQZF1DX');
});

test('spotify refuses an id that is not one', () => {
	for (const href of [
		'https://open.spotify.com/track/6rqhFgb[bKwnb',
		'https://open.spotify.com/track/6rqhFgb_bKwnb',
		'https://open.spotify.com/track/6rqhFgb`bKwnb',
		'https://open.spotify.com/track/',
		'https://open.spotify.com/',
	]) {
		assert.equal(Boolean(spotify.detect(new URL(href))), false, `${href} should be left alone`);
	}
});

// A third inherited endpoint that had stopped answering. The handler called
// `/api/v2/images/show.json?ids=…`, which returned 400 for every id probed on
// 2026-09-02 - the route looks retired - so a derpibooru link produced no
// expando at all. Ported to v1, and covered here with recorded responses rather
// than a live call, which is what let the v2 route rot unnoticed: the only test
// it had asserted the URL the handler built.
const derpibooru = await host('lib/modules/hosts/derpibooru.js', 'derpibooru-url-shapes');

const DERPI = {
	// Trimmed from the real `GET /api/v1/json/images/1` on 2026-09-02.
	1: { image: { id: 1, view_url: 'https://derpicdn.net/img/view/2012/1/2/1__safe.png', description: 'A pony', source_url: 'https://example.com/art', representations: { full: 'https://derpicdn.net/img/2012/1/2/1/full.png' } } },
	// A duplicate: no view_url of its own, and the id it was merged into.
	975313: { image: { id: 975313, duplicate_of: 84678, hidden_from_users: true } },
	84678: { image: { id: 84678, view_url: 'https://derpicdn.net/img/view/2015/5/6/84678.png', description: '', source_url: '' } },
	// Present but with nothing to show.
	404404: { image: { id: 404404, deletion_reason: 'rule 1' } },
};

function stubDerpibooru(onRequest = () => {}) {
	globalThis.__resSlimAjax = ({ url }) => {
		onRequest(url);
		const id = /images\/(\d+)/.exec(url);
		if (!id) return Promise.reject(new Error(`unexpected derpibooru request: ${url}`));
		const body = DERPI[Number(id[1])];
		if (!body) return Promise.reject(new Error(`404 for ${url}`));
		return Promise.resolve(body);
	};
}

test('derpibooru asks v1 for the image, and reads the fields v1 returns', async () => {
	const urls = [];
	stubDerpibooru(url => urls.push(url));
	try {
		const media = await embedFor(derpibooru, 'https://derpibooru.org/images/1');
		assert.deepEqual(urls, ['https://derpibooru.org/api/v1/json/images/1'], 'the retired v2 route must not come back');
		assert.equal(media.type, 'IMAGE');
		assert.equal(media.src, 'https://derpicdn.net/img/view/2012/1/2/1__safe.png');
		assert.equal(media.caption, 'A pony');
		// `string.escape` escapes the slashes, which is what puts this string
		// safely into an href.
		assert.match(media.credits, /example\.com&#47;art/);
	} finally {
		delete globalThis.__resSlimAjax;
	}
});

test('derpibooru follows a duplicate to the image it was merged into', async () => {
	const urls = [];
	stubDerpibooru(url => urls.push(url));
	try {
		const media = await embedFor(derpibooru, 'https://derpibooru.org/images/975313');
		assert.deepEqual(urls, [
			'https://derpibooru.org/api/v1/json/images/975313',
			'https://derpibooru.org/api/v1/json/images/84678',
		]);
		assert.equal(media.src, 'https://derpicdn.net/img/view/2015/5/6/84678.png');
		assert.equal(media.credits, undefined, 'no source means no credits line');
	} finally {
		delete globalThis.__resSlimAjax;
	}
});

test('derpibooru refuses an image with nothing to show, and an id that is not there', async () => {
	stubDerpibooru();
	try {
		await assert.rejects(embedFor(derpibooru, 'https://derpibooru.org/images/404404'), /deleted or other error/);
		await assert.rejects(embedFor(derpibooru, 'https://derpibooru.org/images/999999'), /404/);
	} finally {
		delete globalThis.__resSlimAjax;
	}
});

test('derpibooru still recognises the CDN and legacy link shapes', () => {
	for (const href of [
		'https://derpibooru.org/1',
		'https://derpibooru.org/images/1',
		'https://trixiebooru.org/images/1',
		'https://derpicdn.net/img/view/2012/1/2/1__safe.png',
	]) {
		assert.ok(derpibooru.detect(new URL(href)), `${href} should expand`);
	}
	assert.equal(Boolean(derpibooru.detect(new URL('https://derpibooru.org/search?q=safe'))), false);
});
