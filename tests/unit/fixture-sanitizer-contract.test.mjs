/* eslint-disable import/no-nodejs-modules */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { assertSanitizedFixture, extractHtmlDocument, sanitizeFixtureHtml } from '../../scripts/fixture-sanitizer.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const fixture = name => fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'mhtml', name), 'utf8');

const bait = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>
	<title>Wide-Friendship-2287 private capture</title>
	<meta http-equiv="set-cookie" content="session=super-secret-cookie">
	<script nonce="secret-token">window.__token = 'bearer secret-bait-token'</script>
</head><body class="listing-page loggedin best-page">
	<header id="header" role="banner"><div id="header-bottom-right"><span class="user"><a href="/user/Wide-Friendship-2287/">Wide-Friendship-2287</a></span><a id="mail" href="/message/inbox/?token=private">messages</a></div></header>
	<main class="content" role="main"><div id="siteTable" class="sitetable linklisting">
		<div id="thing_t3_secretpost" class="thing link odd id-t3_secretpost" data-fullname="t3_secretpost" data-author="Wide-Friendship-2287" data-subreddit="secretcommunity" data-subreddit-prefixed="r/secretcommunity" data-permalink="/r/secretcommunity/comments/secretpost/private-title/" data-url="https://private.example/alice" data-domain="private.example" data-token="leakme" onclick="stealCookie()">
			<div class="midcol"><div class="score">999999</div></div><div class="entry"><p class="title"><a class="title" href="/gallery/privategalleryid">My identifiable private story</a></p><p class="tagline">submitted by <a class="author" href="/user/Wide-Friendship-2287/">Wide-Friendship-2287</a> to <a class="subreddit" href="/r/secretcommunity/">r/secretcommunity</a></p><div class="expando-button image"></div><div class="expando"><div id="media-private-asset-id">Private media label</div></div></div>
		</div>
	</div></main>
	<aside class="side"><form id="search" role="search"><input name="q" type="text" value="private query"><input name="uh" value="private-modhash"></form></aside>
</body></html>`;

test('fresh-fixture sanitizer removes identity, secrets, executable content, and private URLs', () => {
	const { html, kind } = sanitizeFixtureHtml(bait, {
		kind: 'frontpage',
		sourceName: 'account-capture.html',
		capturedAt: '2026-08-13T12:00:00.000Z',
	});
	assert.equal(kind, 'frontpage');
	assertSanitizedFixture(html);
	for (const secret of ['Wide-Friendship-2287', 'secretcommunity', 'secretpost', 'privategalleryid', 'private-asset-id', 'private.example', 'private query', 'super-secret-cookie', 'secret-bait-token', 'leakme']) {
		assert.doesNotMatch(html, new RegExp(secret, 'i'));
	}
	assert.doesNotMatch(html, /<script|onclick=|http-equiv="set-cookie"|name="uh"/i);
	assert.match(html, /data-author="fixture_author"/);
	assert.match(html, /data-subreddit="fixture"/);
	assert.match(html, />Fixture post title</);
	assert.match(html, /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
});

test('sanitization is deterministic for identical source and metadata', () => {
	const options = { kind: 'frontpage', sourceName: 'capture.html', capturedAt: '2026-08-13T12:00:00.000Z' };
	assert.equal(sanitizeFixtureHtml(bait, options).html, sanitizeFixtureHtml(bait, options).html);
});

test('raw quoted-printable MHTML imports its HTML part before sanitizing', () => {
	const boundary = '----MultipartBoundaryFixture';
	const encoded = bait.replace(/=/g, '=3D');
	const mhtml = [
		'From: <Saved by Blink>',
		`Content-Type: multipart/related; boundary="${boundary}"`,
		'',
		`--${boundary}`,
		'Content-Type: text/html; charset=utf-8',
		'Content-Transfer-Encoding: quoted-printable',
		'',
		encoded,
		`--${boundary}--`,
		'',
	].join('\r\n');
	assert.match(extractHtmlDocument(mhtml), /<html xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
	const { html } = sanitizeFixtureHtml(mhtml, { kind: 'frontpage', sourceName: 'live-capture.mhtml', capturedAt: '2026-08-13T12:00:00Z' });
	assertSanitizedFixture(html);
	assert.doesNotMatch(html, /Wide-Friendship-2287|secret-bait-token/);
});

test('private message and moderation captures are rejected before writing', () => {
	for (const privateClass of ['messages-page', 'modqueue-page', 'saved-page']) {
		const source = bait.replace('listing-page loggedin best-page', `listing-page loggedin ${privateClass}`);
		assert.throws(() => sanitizeFixtureHtml(source), /private Reddit surface/);
	}
	assert.throws(() => sanitizeFixtureHtml(bait.replace('xmlns="http://www.w3.org/1999/xhtml"', '')), /missing <html xmlns/);
});

test('the committed structural fixtures pass the privacy gate and selector surfaces', () => {
	for (const [name, expected] of [['frontpage.html', 'listing-page'], ['thread.html', 'commentarea']]) {
		const html = fixture(name);
		assertSanitizedFixture(html);
		const document = new JSDOM(html).window.document;
		assert.equal(document.documentElement.getAttribute('xmlns'), 'http://www.w3.org/1999/xhtml');
		assert.ok(document.querySelector(`.${expected}`));
		assert.ok(document.querySelector('#header[role="banner"]'));
		assert.ok(document.querySelector('#search[role="search"] input[name="q"]'));
	}
});
