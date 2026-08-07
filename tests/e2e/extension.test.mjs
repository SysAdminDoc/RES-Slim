// End-to-end checks that run the built extension in a real browser.
//
// These are the tests the unit suite structurally cannot write. Every contract
// under tests/unit/ either regexes source or executes a pure helper in Node; none
// of them can tell you whether the MV3 service worker actually registers, whether
// the options page renders, or whether the content script initialises on a real
// reddit document. All three have broken silently in this repo before.
//
//   yarn once && yarn test:e2e
//
// Headless by default. `RES_E2E_HEADED=1` opens a visible window, and only on the
// isolated virtual display — see harness.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';

import { launchWithExtension, extensionUrl, assertBuilt, repoRoot, saveScreenshotDir } from './harness.mjs';

// The committed skeleton, not the full `.research/` capture: `.research/` is
// gitignored, so a test sourced from it cannot run on a fresh clone. This is the
// same fixture the selector contracts assert against, which is the point — if the
// two ever disagree about old.reddit's shape, one of them is measuring nothing.
const CAPTURE = path.join(repoRoot, 'tests', 'fixtures', 'mhtml', 'thread.html');

// A capture taken from a browser that already had RES-Slim installed carries
// res-* classes on <html>, and foreground.entry.js treats those as "already
// initialised here" and bails. Serving such a capture unmodified would measure an
// inert page while looking like a clean pass, and would also satisfy this test's
// own `res` assertion without the extension ever running. Stripped defensively
// even though the committed fixture is currently clean.
function servableCapture() {
	const raw = fs.readFileSync(CAPTURE, 'utf8');
	const stripped = raw.replace(/<html([^>]*)class="([^"]*)"/i, (whole, attrs, classes) => {
		const kept = classes.split(/\s+/).filter(c => c && !/^res(-|$)/.test(c)).join(' ');
		return `<html${attrs}class="${kept}"`;
	});
	assert.ok(!/<html[^>]*\bclass="[^"]*\bres\b/i.test(stripped), 'res classes must be stripped from the served capture');
	return stripped;
}

test('the built extension loads and its service worker registers', async t => {
	const manifest = assertBuilt();
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

	const { context, worker, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	assert.match(worker.url(), /background\.entry\.js$/, 'the registered worker must be our background entrypoint');
	assert.match(extensionId, /^[a-p]{32}$/, 'extension id should be a normal 32-char runtime id');
	assert.equal(manifest.version, pkg.version, 'built manifest version must track package.json');
	assert.equal(manifest.manifest_version, 3, 'chrome target is MV3');

	assert.ok(context.serviceWorkers().length >= 1);

	// Registration alone is not aliveness. Chromium registers and exposes the
	// worker target even when the script throws on its first line, so asserting
	// only that a `serviceworker` event fired passes against a completely dead
	// background — verified by disarming background.entry.js, which this test used
	// to survive. What a throwing worker cannot do is answer a message, because
	// the listener registry is built as a side effect of the module graph loading.
	const page = await context.newPage();
	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });

	const token = `e2e-${Date.now()}`;
	const roundTrip = await page.evaluate(async key => {
		const send = payload => new Promise(resolve => chrome.runtime.sendMessage(payload, resolve));
		await send({ type: 'session', data: ['set', key, 'alive'] });
		const got = await send({ type: 'session', data: ['get', key] });
		return got && got.data;
	}, token);
	assert.equal(roundTrip, 'alive', 'background worker must serve its own message listeners');
});

// Every cross-origin request the extension makes is proxied through the service
// worker's `ajax` listener, so the `extension_pages` CSP governs all of them —
// including the ones a *content script* appears to make. That is not obvious, and
// getting it wrong is silent: a blocked fetch is an ordinary `TypeError: Failed
// to fetch`, indistinguishable from the host being down.
//
// `connect-src https:` therefore blocked every http request, and `localCompanion`
// talks to `http://127.0.0.1:7860` by design — so that module could never have
// worked. Only a real browser can prove this either way; jsdom has no CSP.
test('the service worker CSP permits the origins the extension actually fetches', async t => {
	const { worker, dispose } = await launchWithExtension();
	t.after(dispose);

	// `fetch` from the worker, reporting whether the request was allowed to leave.
	// A CSP refusal and a dead host both surface as `TypeError: Failed to fetch`,
	// which is why the localhost cases below are asserted against a live server.
	const attempt = url => worker.evaluate(async u => {
		try {
			await fetch(u, { method: 'GET' });
			return true;
		} catch (e) {
			return false;
		}
	}, url);

	// CORS headers on purpose. There are two independent gates between the worker
	// and a localhost helper, and both fail as the same `TypeError: Failed to
	// fetch`: the CSP, and CORS. This test is about the CSP, so CORS is satisfied
	// here to isolate it — the CORS half is handled in the product by
	// `localCompanion` requesting the localhost origin as an optional permission,
	// which a headless test cannot grant.
	const server = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
		res.end('{"ok":true}');
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	const { port } = server.address();

	// A live local server: if these fail it is CSP, not the network.
	assert.equal(await attempt(`http://127.0.0.1:${port}/health`), true, 'localCompanion talks to http://127.0.0.1 and cannot work without it');
	assert.equal(await attempt(`http://localhost:${port}/health`), true, 'the companion URL may be spelled localhost too');

	assert.equal(await attempt('https://old.reddit.com/api/me.json'), true, 'reddit itself must remain reachable');
});

test('the settings console renders in the options page', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', e => pageErrors.push(String(e)));

	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	const moduleRows = await page.locator('.moduleRow').count();
	assert.ok(moduleRows > 0, `expected module rows in the sidebar, saw ${moduleRows}`);

	// The category tablist is the v0.19.0 navigation redesign; if it is missing the
	// console has fallen back to something the unit contracts would not notice.
	const tabs = await page.locator('[role="tablist"] [role="tab"]').count();
	assert.ok(tabs > 0, 'settings console should render its category tablist');

	// A missing locale key renders as the key itself rather than throwing, which is
	// how `privacyCategory` once shipped visible in a sidebar heading.
	const bodyText = await page.locator('body').innerText();
	assert.ok(!/\b[a-z]+[A-Z][A-Za-z]*Category\b/.test(bodyText), 'no raw i18n keys should be visible in the console');

	assert.deepEqual(pageErrors, [], 'options page must load without uncaught errors');

	const dir = saveScreenshotDir();
	await page.screenshot({ path: path.join(dir, 'settings-console.png'), fullPage: false });
});

test('the content script initialises on a real old.reddit document', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const html = servableCapture();
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', e => pageErrors.push(String(e)));

	// Serve the captured thread offline. Subresources are stubbed empty rather than
	// left to fail so the console stays readable and no test depends on the network.
	await context.route('**/*', async route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/r/codex/comments/1th66mb/this_has_to_stop/', { waitUntil: 'domcontentloaded' });

	// The extension marks the document it has taken over. Waiting on this is the
	// single honest signal that the content script ran — not that the file loaded.
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });

	const classes = await page.evaluate(() => document.documentElement.className);
	assert.match(classes, /\bres\b/, 'foreground entry should mark <html> as initialised');
	assert.match(classes, /\bres-v\d/, 'version classes should be applied');

	// Initialising is not enough — the extension must also classify the page as
	// *old* reddit. `appType()` (lib/utils/currentLocation.js) returns 'r2' only
	// when <html> carries the xmlns attribute and otherwise returns 'd2x', and the
	// 40-odd `module.include = ['r2']` modules are skipped entirely on 'd2x'. Both
	// committed fixtures were missing that attribute, so every selector contract
	// was asserting against a document the product would treat as the redesign.
	const isOldReddit = await page.evaluate(() => !!document.documentElement.getAttribute('xmlns'));
	assert.equal(isOldReddit, true, 'fixture must carry the xmlns marker that makes appType() report r2');

	// It parsed the page as old reddit rather than falling through to a
	// compatibility no-op: the extension's own stylesheet is present and Things
	// were discovered.
	const thingCount = await page.locator('.thing').count();
	assert.ok(thingCount > 0, 'captured thread should contain Things for modules to walk');

	// The committed fixture's `#header-bottom-right` has no `ul`, which is the
	// logged-out shape the floater's userMenu fallback exists to survive. It
	// creates an empty one — and the separator used to be appended before every
	// item unconditionally, so the first rendered as a dangling "| storage".
	// Only visible in a real render; no unit contract can see it.
	const userbarText = await page.evaluate(() => {
		const bar = document.querySelector('#header-bottom-right');
		return bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null;
	});
	assert.notEqual(userbarText, null, 'the fixture should have a userbar to inject into');
	assert.ok(!userbarText.startsWith('|'), `userbar must not start with a separator: ${userbarText}`);
	assert.ok(!/\|\s*\|/.test(userbarText), `no doubled separators: ${userbarText}`);

	assert.deepEqual(pageErrors, [], 'content script must initialise without uncaught errors');

	const dir = saveScreenshotDir();
	await page.screenshot({ path: path.join(dir, 'thread.png'), fullPage: false });
});
