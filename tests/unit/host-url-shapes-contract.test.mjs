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
