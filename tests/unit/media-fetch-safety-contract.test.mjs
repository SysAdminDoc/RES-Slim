// Four places where the extension fetches, or saves, something a post chose.
//
// `hoverZoom` is the sharpest: it is off by default, but once on it requests
// from whatever host a link names, on hover, before any click. Without a
// referrer policy that request carries the full Reddit URL the reader is on --
// the subreddit, the post, and on a profile the account -- to a host chosen by
// whoever posted the link. Hovering is not consent to be identified. And with
// "require direct URL" off it hands the raw href straight to a `src`, so the
// scheme is whatever the post said it was.
//
// The cobalt downloader takes the filename from the instance, which is where a
// path separator or a reserved Windows name would land, and started one download
// per entry in a list the instance also controls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const mediaUrl = await loadFlowModule('lib/utils/mediaUrl.js', 'media-fetch-safety-url');
const names = await loadFlowModule('lib/utils/downloadFilename.js', 'media-fetch-safety-names');

const hoverZoom = codeOnly(readRepoFile('lib/modules/hoverZoom.js'));
const cobalt = codeOnly(readRepoFile('lib/modules/cobaltDownloader.js'));

test('a hovered preview asks for the media without saying where the reader is', () => {
	// Set before the src, because the src is what starts the request.
	const build = hoverZoom.slice(hoverZoom.indexOf('function buildPopover'), hoverZoom.indexOf('function positionPopover'));

	for (const [element, srcLine] of [['img', 'img.src = url;'], ['video', 'video.src = url;']]) {
		const policyAt = build.indexOf(`${element}.referrerPolicy = 'no-referrer';`);
		const srcAt = build.indexOf(srcLine);
		assert.ok(policyAt > -1, `the ${element} preview still sends a referrer`);
		assert.ok(srcAt > -1);
		assert.ok(policyAt < srcAt, `the ${element} referrer policy is set after the request has started`);
	}
});

test('a hovered link with a scheme that is not media never becomes a src', () => {
	// With "require direct URL" off the raw href is used, so this is whatever the
	// post put in the markup.
	const build = hoverZoom.slice(hoverZoom.indexOf('function buildPopover'), hoverZoom.indexOf('function positionPopover'));
	assert.match(build, /if \(!isSafeMediaUrl\(url, location\.href\)\) return null;/, 'the scheme is never checked');

	// The gate is the shared one, and it is the shared one's answers that matter.
	for (const refused of [
		// eslint-disable-next-line no-script-url
		'javascript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:x',
		'',
		null,
	]) {
		assert.equal(mediaUrl.isSafeMediaUrl(refused, 'https://old.reddit.com/'), false, String(refused));
	}
	for (const allowed of ['https://i.redd.it/a.jpg', 'http://example.com/a.mp4', 'blob:https://old.reddit.com/x']) {
		assert.equal(mediaUrl.isSafeMediaUrl(allowed, 'https://old.reddit.com/'), true, allowed);
	}

	// And the caller stops rather than carrying on with a null popover.
	assert.match(hoverZoom, /const pop = buildPopover\(url, kind\);\n\t\tif \(!pop\) return;/);
});

test('a filename the instance chose cannot choose where the file goes', () => {
	assert.match(cobalt, /a\.download = downloadFilename\(filename, url\);/, 'the instance names the file directly');
	// Nothing on this path passes a raw name any more.
	assert.ok(!/a\.download = filename/.test(cobalt));

	// What the shared sanitiser does with the shapes that matter.
	for (const [given, url] of [
		['../../evil.mp4', 'https://example.com/a.mp4'],
		['..\\\\evil.mp4', 'https://example.com/a.mp4'],
		['/etc/passwd', 'https://example.com/a.mp4'],
		['CON', 'https://example.com/a.mp4'],
		['.', 'https://example.com/a.mp4'],
		['', 'https://example.com/a.mp4'],
	]) {
		const name = names.downloadFilename(given, url);
		assert.ok(!name.includes('/'), `${given} produced ${name}`);
		assert.ok(!name.includes('\\\\'), `${given} produced ${name}`);
		assert.ok(!name.startsWith('.'), `${given} produced ${name}`);
		assert.ok(name.length > 0);
	}

	// An ordinary name still survives recognisably.
	assert.match(names.downloadFilename('a nice clip.mp4', 'https://example.com/x.mp4'), /nice/);
});

test('one picker answer cannot start five hundred downloads', () => {
	const picker = cobalt.slice(cobalt.indexOf('const picker = '), cobalt.indexOf('cobalt error:'));
	assert.match(picker, /slice\(0, MAX_PICKER_DOWNLOADS\)/, 'the picker is still uncapped');
	assert.match(cobalt, /const MAX_PICKER_DOWNLOADS = \d+;/);

	// And the reader is told what was withheld, rather than quietly getting part
	// of what the instance offered.
	assert.match(picker, /more not taken/);
});

test('an instance that never answers does not hold the button forever', () => {
	assert.match(cobalt, /signal: AbortSignal\.timeout\(INSTANCE_TIMEOUT_MS\)/);
	assert.match(cobalt, /const INSTANCE_TIMEOUT_MS = \d+;/);
});

test('the Steam image is fetched over the scheme reddit is served on', () => {
	// A mixed-content image on an https page is blocked, not downgraded, so this
	// expando showed nothing at all.
	const steam = codeOnly(readRepoFile('lib/modules/hosts/steampowered.js'));
	assert.ok(!/http:\/\//.test(steam), 'the Steam host still builds an http URL');
	assert.match(steam, /https:\/\/images\.akamai\.steamusercontent\.com/);
});

test('a v.redd.it manifest with no BaseURL loses a representation, not the video', () => {
	// Reddit describes some videos with `SegmentTemplate` and no `BaseURL` at all.
	// Reading `.textContent` off the missing element threw out of the handler, so
	// a video dash could have played fine lost its expando entirely.
	const vreddit = codeOnly(readRepoFile('lib/modules/hosts/vreddit.js'));
	assert.match(vreddit, /if \(!baseURLElement \|\| !baseURLElement\.textContent\) continue;/);
	assert.ok(
		!/source: rep\.querySelector\('BaseURL'\)\.textContent/.test(vreddit),
		'the direct-mp4 path still dereferences a BaseURL that may not be there',
	);
	assert.match(vreddit, /const everySourceIsDirect = /);
	assert.match(vreddit, /\(muted && id && everySourceIsDirect\) \?/);
});
