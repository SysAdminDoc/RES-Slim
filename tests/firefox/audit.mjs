// Drives the built MV2 add-on in a real Firefox.
//
// Everything else in this repo that claims to verify behaviour drives Chromium.
// The Firefox target was shipped on static manifest checks alone, and an attempt
// on 2026-08-08 to close that ended with `-install-addon` refused by Playwright's
// Firefox and the WebDriver temporary-addon endpoint hanging. Playwright still
// cannot load a Firefox extension (microsoft/playwright#7297, open).
//
// What changed: WebDriver BiDi specifies `webExtension.install` (§7.10), Firefox
// implements it from 137 (bug 1934551), and Puppeteer exposes it as
// `browser.installExtension()` behind an `enableExtensions` launch option. So the
// loader the blocked item was waiting for exists.
//
// Deliberately not a `yarn verify` gate. It needs a system Firefox that the
// repo does not install, and a gate that cannot run on a clean machine is a gate
// that gets skipped. Run it before a release, or when something touches the
// manifest or the page-world injection.
//
// Usage: yarn firefox:audit  (add --headful to watch it)

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const headful = process.argv.includes('--headful');

// Declared in `manifest.config.js` and asserted by `build-release-contract`.
const ADDON_ID = 'res-slim@sysadmindoc';

const FIREFOX_CANDIDATES = [
	'C:/Program Files/Mozilla Firefox/firefox.exe',
	'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
	'/Applications/Firefox.app/Contents/MacOS/firefox',
	'/usr/bin/firefox',
	'/usr/lib/firefox/firefox',
];

const results = [];
function record(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function findFirefox() {
	if (process.env.FIREFOX_PATH) return process.env.FIREFOX_PATH;
	return FIREFOX_CANDIDATES.find(candidate => fs.existsSync(candidate));
}

// The content script matches `https://*.reddit.com/*` and nothing else, so a
// page served from localhost is not a page this extension runs on. Everything
// interesting therefore has to arrive at a reddit URL, which means intercepting
// the request rather than serving it.
const FIXTURE = fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'mhtml', 'frontpage.html'), 'utf8')
	.replace(/<html([^>]*)class="([^"]*)"/i, (whole, attrs, classes) => {
		const kept = classes.split(/\s+/).filter(c => c && !/^res(-|$)/.test(c)).join(' ');
		return `<html${attrs}class="${kept}"`;
	});

async function main() {
	const executablePath = findFirefox();
	if (!executablePath) {
		console.error('No Firefox found. Install one, or set FIREFOX_PATH.');
		console.error(`Looked in:\n${FIREFOX_CANDIDATES.map(c => `  ${c}`).join('\n')}`);
		process.exit(2);
	}

	const buildDir = path.join(repoRoot, 'dist', 'firefox');
	if (!fs.existsSync(path.join(buildDir, 'manifest.json'))) {
		console.error(`No build at ${buildDir}. Run \`yarn once\` or \`yarn build\` first.`);
		process.exit(2);
	}

	const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'));
	console.log(`Firefox: ${executablePath}`);
	console.log(`Add-on:  RES-Slim ${manifest.version}, MV${manifest.manifest_version}, min ${manifest.browser_specific_settings.gecko.strict_min_version}\n`);

	// A no-op server. Firefox will not route a request it cannot resolve, and the
	// interception below needs something to intercept; pointing DNS-free traffic
	// at a live local listener is the cheap way to keep the navigation from
	// failing before the handler sees it.
	const server = http.createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(FIXTURE);
	});
	await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });

	// `moz-extension://` hosts are a per-profile UUID Firefox generates at install
	// and does not expose over BiDi. Pinning it through the pref that maps add-on
	// id to UUID is the supported way to know the URL in advance; the alternative
	// is scraping about:debugging, which is markup, not an API.
	const EXTENSION_UUID = '11111111-2222-3333-4444-555555555555';

	const browser = await puppeteer.launch({
		browser: 'firefox',
		executablePath,
		headless: !headful,
		enableExtensions: true,
		protocol: 'webDriverBiDi',
		extraPrefsFirefox: {
			'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: EXTENSION_UUID }),
		},
	});

	try {
		let extensionId;
		try {
			extensionId = await browser.installExtension(buildDir);
			record('the built MV2 add-on installs into a fresh profile', true, `id ${extensionId}`);
		} catch (e) {
			record('the built MV2 add-on installs into a fresh profile', false, e.message);
			throw e;
		}

		// The page-world half. `eventTrackingSabotage` was inert on Chrome for the
		// life of the project because MV3 refuses an inline script a content script
		// writes; the fix ships it as a web-accessible file. MV2 Firefox applies the
		// *page* CSP instead, so it was failing there for a different reason or not
		// at all, and nothing on this machine had ever run it on Firefox. This is
		// the audit's first question.
		const fixturePage = await browser.newPage();
		try {
			await fixturePage.setRequestInterception(true);
			// Matched by URL rather than by resource type: `resourceType()` throws
			// `UnsupportedOperation` on the BiDi transport, so the Chromium habit of
			// filtering on it does not carry over.
			fixturePage.on('request', request => {
				const url = request.url();
				if (url.includes('old.reddit.com') && !/\.(?:js|css|png|jpe?g|gif|svg|woff2?|json)(?:$|\?)/i.test(url)) {
					return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE });
				}
				if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1')) {
					return request.respond({ status: 200, contentType: 'text/plain', body: '' });
				}
				return request.continue();
			});
			record('request interception is available over BiDi', true);
		} catch (e) {
			record('request interception is available over BiDi', false, e.message.split('\n')[0]);
		}

		try {
			await fixturePage.goto('https://old.reddit.com/rsm-firefox-audit/', { waitUntil: 'domcontentloaded', timeout: 30000 });
			await fixturePage.waitForFunction(() => document.documentElement.classList.contains('res'), { timeout: 30000 });
			record('the content script runs on a reddit page', true);
		} catch (e) {
			record('the content script runs on a reddit page', false, e.message.split('\n')[0]);
		}

		try {
			// Read in the main world, which is the only place the answer exists: a
			// patched `sendBeacon` no longer stringifies as native code. Asserting
			// the source of the injected file instead is the mistake that let this
			// module ship inert for its whole life.
			const patched = await fixturePage.evaluate(() => ({
				beacon: String(navigator.sendBeacon),
				fetch: String(window.fetch),
			}));
			// Measured 2026-08-19: MV2 Firefox loads this injected `<script src>` even
			// with the file absent from `web_accessible_resources`, where MV3 Chrome
			// refuses it. Baiting the listing therefore proves nothing here; baiting
			// the file does, and does fail. Keep the listing anyway - both manifests
			// come from one source, and Chrome needs it.
			const isPatched = !patched.beacon.includes('[native code]');
			record(
				'the page-world telemetry patch is delivered on MV2',
				isPatched,
				isPatched ? 'sendBeacon is no longer native' : 'sendBeacon still reads [native code] — the web_accessible_resources route did not land here',
			);
		} catch (e) {
			record('the page-world telemetry patch is delivered on MV2', false, e.message.split('\n')[0]);
		}

		// The settings console, reached the way a user reaches it.
		//
		// Two things get in the way of measuring this, and neither is a defect in
		// the add-on. A direct `browsingContext.navigate` to a `moz-extension://`
		// URL is refused by Firefox as a privileged destination. And a cross-origin
		// extension frame is not reported by `page.frames()` over BiDi at all - it
		// stays `about:blank` there for as long as you care to poll, while the
		// frame itself is loaded and running.
		//
		// So the console is opened the way `settingsNavigation` opens it, from the
		// page, and asked a question only a booted console can answer. Its reply
		// arrives after `Core.loadI18n` and `Core.loadOptions` have both resolved,
		// and both of those are storage round trips through the MV2 background
		// page - which is why one message covers the background lifecycle too.
		try {
			await fixturePage.evaluate(() => { location.hash = '#res:settings/'; });
			await fixturePage.waitForSelector('#console-container', { timeout: 30000 });

			const reply = await fixturePage.evaluate(() => new Promise(resolve => {
				const frame = document.querySelector('#console-container');
				if (!frame) { resolve(null); return; }
				const seen = [];
				window.addEventListener('message', event => {
					if (event.origin.startsWith('moz-extension://')) seen.push(event.data);
				});
				const ask = () => frame.contentWindow.postMessage({ load: {} }, '*');
				const timer = setInterval(ask, 1000);
				ask();
				setTimeout(() => { clearInterval(timer); resolve(seen.length ? seen[0] : null); }, 20000);
			}));

			const booted = !!reply;
			record('the settings console boots and answers from options.html', booted,
				booted ? `replied ${JSON.stringify(reply)}` : 'no reply from the console frame in 20s');
			record('i18n and module options load through the MV2 background page', booted,
				booted ? 'the console only answers after both resolve' : 'not reached');

			// Firefox 152 removed script injection into an extension's own
			// `moz-extension:` pages. This build never did that - the console is a
			// bundled script the page loads itself - so the boot above answers it.
			// Recorded because "did not apply" is an answer the audit exists to give.
			record('Firefox 152: no injection into the add-on own pages', true, 'options.html loads its own bundle; nothing injects into it');
		} catch (e) {
			record('the settings console boots and answers from options.html', false, e.message.split('\n')[0]);
		}

		// Firefox 153 made `file://` access opt-in and off by default. Nothing in
		// this build asks for it: there is no `file://` match anywhere in the
		// manifest, and the only local endpoints are the localCompanion loopback
		// ones, which are http.
		const wantsFileAccess = JSON.stringify(manifest).includes('file://');
		record('Firefox 153: file:// access is not something this build needs', !wantsFileAccess,
			wantsFileAccess ? 'the manifest asks for file:// somewhere' : 'no file:// match in the manifest');

		// Mozilla Bug 1957822: Firefox refuses `permissions.request()` when the
		// calling document is in an extension popup window, which is the topology
		// the prompt used on every browser. The fix is a build-time branch, so what
		// matters here is which half survived into the add-on Firefox is running.
		//
		// The native permission panel itself is browser chrome. BiDi drives content,
		// not chrome, so the grant click is not automatable from here — the tab is
		// the part that was wrong and the part this can prove.
		//
		// Both spellings of the flag: `active: true` only becomes `active:!0` once
		// esbuild minifies, and `build.js` minifies for production only — so
		// matching the minified form alone failed on exactly the development build
		// the missing-build message above tells you to make.
		//
		// What this proves is that the Firefox bundle carries the tab path at all.
		// It cannot prove the popup path is gone: esbuild leaves the losing branch
		// in place as unreachable code rather than deleting it, so the string
		// `type: "popup"` is still in a production bundle. Which branch actually
		// runs is proven by `permission-prompt-surface-contract`, which executes
		// the module against a fake `chrome` under each build target.
		const background = fs.readFileSync(path.join(buildDir, 'background.entry.js'), 'utf8');
		const opensATab = /tabs\.create/.test(background) && /active:\s*(?:true|!0)/.test(background);
		record('the permission prompt carries the normal-tab path Firefox needs', opensATab,
			opensATab ? 'tabs.create with an active flag is in the built background' : 'the built background has no active-tab prompt path');
	} finally {
		await browser.close();
		server.close();
	}

	const failed = results.filter(entry => !entry.ok);
	console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
	if (failed.length) {
		console.error(`\nFailures:\n${failed.map(entry => `  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`).join('\n')}`);
		process.exit(1);
	}
}

main().catch(error => {
	console.error(`\nThe audit could not complete: ${error.message}`);
	process.exit(1);
});
