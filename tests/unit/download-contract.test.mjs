// The background download proxy, executed rather than pattern-matched.
//
// This contract used to assert that `download.js` *contained* the strings
// `const downloadFile = apiToPromise` and `return downloadFile({ url, filename`.
// That proves the code is written. It cannot prove the scheme guard runs, that a
// blocked URL never reaches `chrome.downloads`, or that a legitimate download
// still gets through — which is the entire point of the guard.
//
// The proxy is a confused-deputy surface: it is reachable from the content
// script, so a content-script XSS could otherwise ask the privileged background
// to fetch `file:///` or `javascript:` on its behalf. The browser enforces the
// host boundary; the scheme check is ours to enforce, and ours to test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';
import { codeOnly, readRepoFile } from './helpers/loadFlowModule.mjs';

await loadModule('lib/environment/background/download.js', 'download-proxy');

// Drive a message the way chrome does: hand it to every registered listener and
// resolve on the first one that answers. A listener returning true means it will
// respond asynchronously, which is the path `apiToPromise` takes.
function dispatch(payload, sender = { tab: { incognito: false } }) {
	return new Promise(resolve => {
		let asyncPending = 0;
		const replies = [];

		for (const listener of globalThis.__chromeMessageListeners) {
			try {
				const willReplyLater = listener(payload, sender, reply => {
					replies.push(reply);
					resolve(replies);
				});
				if (willReplyLater) asyncPending++;
			} catch (e) {
				replies.push({ error: { message: e.message } });
			}
		}

		if (!asyncPending) resolve(replies);
	});
}

function downloadsSince(mark) {
	return globalThis.__chromeDownloads.slice(mark);
}

test('a legitimate download reaches chrome.downloads with its filename', async () => {
	const mark = globalThis.__chromeDownloads.length;

	await dispatch({ type: 'download', data: { url: 'https://i.imgur.com/abc123.png', filename: 'abc123.png' } });
	await new Promise(resolve => setTimeout(resolve, 0));

	const calls = downloadsSince(mark);
	assert.equal(calls.length, 1, 'the request should have been forwarded');
	assert.equal(calls[0].url, 'https://i.imgur.com/abc123.png');
	assert.equal(calls[0].filename, 'abc123.png');
});

// The security property, executed. Each of these is a scheme a content-script
// XSS would reach for, and none may reach the privileged API.
test('non-http(s) schemes are refused and never reach chrome.downloads', async () => {
	for (const url of [
		'javascript:alert(1)',
		'file:///C:/Windows/System32/config/SAM',
		'data:text/html,<script>alert(1)</script>',
		'blob:https://old.reddit.com/abc',
		'chrome-extension://abcdefghijklmnop/manifest.json',
		'ftp://example.com/x',
	]) {
		const mark = globalThis.__chromeDownloads.length;
		const replies = await dispatch({ type: 'download', data: { url } });
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.deepEqual(downloadsSince(mark), [], `${url} must never reach chrome.downloads`);
		assert.ok(
			replies.some(r => r && r.error),
			`${url} should return an error to the caller, not fail silently`,
		);
	}
});

test('a malformed or missing URL is refused rather than thrown past the caller', async () => {
	for (const url of ['', '   ', 'not a url', null, undefined, 42, {}]) {
		const mark = globalThis.__chromeDownloads.length;
		await dispatch({ type: 'download', data: { url } });
		await new Promise(resolve => setTimeout(resolve, 0));

		assert.deepEqual(downloadsSince(mark), [], `${String(url)} must never reach chrome.downloads`);
	}
});

// A protocol-relative URL has no scheme of its own. `new URL()` rejects it
// without a base, so it lands on the refusal path — asserted so a future switch
// to a base-relative parse cannot quietly start accepting `//evil.test/x`.
test('a protocol-relative URL is refused', async () => {
	const mark = globalThis.__chromeDownloads.length;
	await dispatch({ type: 'download', data: { url: '//evil.test/payload.exe' } });
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.deepEqual(downloadsSince(mark), []);
});

// Firefox needs the incognito flag forwarded; Chrome must not receive it. The
// build target is fixed at bundle time, so only the non-Firefox branch is
// reachable here — assert that rather than pretending to cover both.
test('the Chrome build does not forward an incognito flag', async () => {
	const mark = globalThis.__chromeDownloads.length;

	await dispatch({ type: 'download', data: { url: 'https://example.com/a.png' } }, { tab: { incognito: true } });
	await new Promise(resolve => setTimeout(resolve, 0));

	const [call] = downloadsSince(mark);
	assert.ok(call, 'the request should have been forwarded');
	assert.equal('incognito' in call, false, 'chrome.downloads rejects an unknown incognito option');
});

// The foreground half is a thin sender; its contract is that it propagates the
// rejection rather than swallowing it, so the caller can show a failure toast.
test('the foreground download surfaces failures instead of swallowing them', () => {
	const foreground = codeOnly(readRepoFile('lib/environment/foreground/download.js'));
	const mediaTypes = codeOnly(readRepoFile('lib/modules/showImages/mediaTypes.js'));

	assert.match(foreground, /return sendMessage\('download'/, 'the foreground must return the promise, not fire and forget');
	assert.ok(!/\.catch\(\s*\(\)\s*=>\s*\{?\s*\}?\s*\)/.test(foreground), 'a bare catch here would hide every failure');
	assert.match(mediaTypes, /notificationID: 'downloadFailed'/, 'a failed download must tell the user');
});
