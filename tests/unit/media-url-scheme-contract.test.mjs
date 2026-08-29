// Every URL a site module hands back goes into an `href`, an `img src`, a
// `video src` or an `iframe src`. `string.html` escapes those for the attribute,
// which stops a breakout but says nothing about the scheme, and only `credits`
// and `caption` were ever sanitized.
//
// Most handlers rebuild the URL from an id their own `detect()` captured, so a
// plain hostile post cannot reach this. Several do not - deviantart returns
// `info.fullsize_url`, flickr `info.url`, gyazo and imgur their `link` field -
// so a compromised media API is enough, and a `javascript:` iframe src runs in
// reddit.com's own origin rather than waiting for a click.
//
// The schemes are assembled at runtime rather than written as literals, because
// this repo's eslint config bans a `javascript:` literal in source and the ban is
// worth keeping. Building the string also proves the guard parses its input
// instead of matching a prefix it was handed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const { isSafeMediaUrl, assertSafeMediaUrls, mediaUrls } =
	await loadFlowModule('lib/utils/mediaUrl.js', 'media-url-scheme');

const PAGE = 'https://www.reddit.com/r/example/';
const safe = url => isSafeMediaUrl(url, PAGE);

const scheme = name => `${name}:`;
const SCRIPT_URL = `${scheme('javascript')}alert(1)`;
const VBSCRIPT_URL = `${scheme('vbscript')}msgbox(1)`;
const DATA_DOCUMENT = `${scheme('data')}text/html,<script>alert(1)</script>`;

test('the allowlist accepts what real media actually uses', () => {
	assert.ok(safe('https://i.redd.it/abc.jpg'));
	assert.ok(safe('http://example.invalid/a.png'));
	assert.ok(safe('//i.redd.it/abc.jpg'), 'a protocol-relative URL resolves to the page scheme');
	assert.ok(safe('/gallery/abc'), 'a same-origin path resolves against the page');
	assert.ok(safe('blob:https://www.reddit.com/1234'), 'galleryZip and the video unloader build object URLs');
	assert.ok(safe('data:image/png;base64,iVBORw0KGgo='));
});

test('the blank document a real host returns is accepted', () => {
	// `googlemaps` returns `about:blank` deliberately when a share link carries a
	// place name instead of coordinates, which is the common shape. Rejecting it
	// broke a live host rather than a hostile one, and the throw escaped
	// `Expando.expand` after the box had been revealed. Exactly this string, not
	// the scheme.
	assert.ok(safe('about:blank'));
	assert.equal(safe('about:srcdoc'), false);
	assert.equal(safe('about:config'), false);
	assert.equal(safe('about:blank#x'), false, 'only the bare blank document');
	assert.doesNotThrow(() => assertSafeMediaUrls({ type: 'IFRAME', embed: 'about:blank' }, PAGE));
});

test('every media descriptor a shipped host can return passes the guard', () => {
	// The first version of this file only ever tested URLs it made up, which is
	// why it could not see that a real host was being rejected. These are the
	// shapes taken verbatim from the handlers in lib/modules/hosts.
	const fromRealHosts = [
		{ type: 'IFRAME', embed: 'about:blank', muted: true },
		{ type: 'IFRAME', embed: 'https://redgifs.com/ifr/x?autoplay=0', embedAutoplay: 'https://redgifs.com/ifr/x' },
		{ type: 'IFRAME', embed: 'https://strawpoll.com/embed/abc123' },
		{ type: 'IFRAME', embed: 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb' },
		{ type: 'IMAGE', src: 'https://i.redd.it/a.jpg' },
		{ type: 'IMAGE', src: '//i.imgur.com/a.jpg' },
		{ type: 'TEXT', src: '<p>wikipedia body</p>' },
		{ type: 'VIDEO', sources: [{ source: 'https://v.redd.it/a/DASH_720.mp4', type: 'video/mp4' }], fallback: 'https://media.giphy.com/media/x/giphy.gif' },
		{ type: 'AUDIO', sources: [{ file: 'https://example.invalid/a.mp3', type: 'audio/mpeg' }] },
		{ type: 'GENERIC_EXPANDO' },
	];
	for (const media of fromRealHosts) {
		assert.doesNotThrow(() => assertSafeMediaUrls(media, PAGE), `a real host's ${media.type} was rejected`);
	}
});

test('the allowlist rejects every scheme that can run code', () => {
	assert.equal(safe(SCRIPT_URL), false);
	assert.equal(safe(SCRIPT_URL.toUpperCase()), false, 'the scheme is case-insensitive');
	assert.equal(safe(` ${SCRIPT_URL}`), false, 'leading whitespace is stripped by the URL parser');
	assert.equal(safe(`\n${SCRIPT_URL}`), false);
	// A data document carries its own script; only images may be inlined.
	assert.equal(safe(DATA_DOCUMENT), false);
	assert.equal(safe(VBSCRIPT_URL), false);
	assert.equal(safe('file:///etc/passwd'), false);
	assert.equal(safe('chrome-extension://abc/background.js'), false);
	assert.equal(safe(''), false);
	assert.equal(safe(null), false);
	assert.equal(safe(42), false);
});

test('an image host cannot smuggle a scheme through src or href', () => {
	assert.throws(
		() => assertSafeMediaUrls({ type: 'IMAGE', src: SCRIPT_URL }, PAGE),
		/unsupported URL scheme/,
	);
	assert.throws(
		() => assertSafeMediaUrls({ type: 'IMAGE', src: 'https://i.redd.it/a.jpg', href: SCRIPT_URL }, PAGE),
		/unsupported URL scheme/,
	);
	// Nor through the field that only the save control reads. It is the one a
	// reader never sees before clicking it, which makes it the easiest to forget.
	assert.throws(
		() => assertSafeMediaUrls({ type: 'IMAGE', src: 'https://i.redd.it/a.jpg', downloadSrc: SCRIPT_URL }, PAGE),
		/unsupported URL scheme/,
	);
	assert.doesNotThrow(() => assertSafeMediaUrls({
		type: 'IMAGE',
		src: 'https://i.redd.it/a.jpg',
		href: 'https://i.redd.it/a.jpg',
		downloadSrc: 'https://i.redd.it/a.jpg',
	}, PAGE));
});

test('an iframe embed is checked, including the autoplay spelling', () => {
	// This is the one that runs without a click.
	assert.throws(() => assertSafeMediaUrls({ type: 'IFRAME', embed: SCRIPT_URL }, PAGE), /unsupported URL scheme/);
	assert.throws(
		() => assertSafeMediaUrls({ type: 'IFRAME', embed: 'https://ok.invalid/e', embedAutoplay: SCRIPT_URL }, PAGE),
		/unsupported URL scheme/,
	);
});

test('every video and audio source is checked, not just the first', () => {
	assert.throws(() => assertSafeMediaUrls({
		type: 'VIDEO',
		sources: [
			{ source: 'https://v.redd.it/a/DASH_720.mp4', type: 'video/mp4' },
			{ source: SCRIPT_URL, type: 'video/mp4' },
		],
	}, PAGE), /unsupported URL scheme/);
	assert.throws(() => assertSafeMediaUrls({
		type: 'VIDEO',
		sources: [{ source: 'https://v.redd.it/a/DASH_720.mp4', type: 'video/mp4' }],
		poster: SCRIPT_URL,
	}, PAGE), /unsupported URL scheme/);
	assert.throws(() => assertSafeMediaUrls({
		type: 'AUDIO',
		sources: [{ file: SCRIPT_URL, type: 'audio/mp4' }],
	}, PAGE), /unsupported URL scheme/);
});

test('a gallery is checked piece by piece', () => {
	assert.throws(() => assertSafeMediaUrls({
		type: 'GALLERY',
		src: [
			{ type: 'IMAGE', src: 'https://i.redd.it/a.jpg' },
			{ type: 'IMAGE', src: SCRIPT_URL },
		],
	}, PAGE), /unsupported URL scheme/);
});

test('every URL-bearing field of every media type is collected', () => {
	// A field this misses is a field the guard silently skips, which is how a
	// checker like this stops being one.
	assert.deepEqual(mediaUrls({ type: 'IMAGE', src: 'a', href: 'b', downloadSrc: 'c' }), ['a', 'b', 'c']);
	assert.deepEqual(
		mediaUrls({
			type: 'VIDEO',
			href: 'a',
			source: 'b',
			poster: 'c',
			fallback: 'd',
			sources: [{ source: 'e', reverse: 'f' }],
		}),
		['a', 'b', 'c', 'd', 'e', 'f'],
	);
	assert.deepEqual(mediaUrls({ type: 'AUDIO', sources: [{ file: 'a' }, { file: 'b' }] }), ['a', 'b']);
	assert.deepEqual(mediaUrls({ type: 'IFRAME', embed: 'a', embedAutoplay: 'b' }), ['a', 'b']);
	assert.deepEqual(mediaUrls({ type: 'TEXT', src: '<p>markup</p>' }), []);
	assert.deepEqual(mediaUrls({ type: 'GENERIC_EXPANDO' }), []);
	assert.deepEqual(mediaUrls(null), []);
});

test('an absent optional field is not treated as a bad URL', () => {
	assert.doesNotThrow(() => assertSafeMediaUrls({ type: 'IMAGE', src: 'https://i.redd.it/a.jpg' }, PAGE));
	assert.doesNotThrow(() => assertSafeMediaUrls({ type: 'VIDEO', sources: [] }, PAGE));
	assert.doesNotThrow(() => assertSafeMediaUrls({ type: 'TEXT', src: '<p>hello</p>' }, PAGE));
	assert.doesNotThrow(() => assertSafeMediaUrls({ type: 'GENERIC_EXPANDO' }, PAGE));
});
