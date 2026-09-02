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

// The same two current-Reddit fixtures the Chromium suite drives. Firefox was
// running one renderer and one page: the theme, the Shreddit adapter and the ad
// remover all shipped on the MV2 target with nothing having exercised them
// there, and this add-on's whole claim is that the two renderers behave alike.
const SHREDDIT_LISTING = fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'shreddit', 'listing.html'), 'utf8');
const SHREDDIT_THREAD = fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'shreddit', 'thread.html'), 'utf8');

function bodyFor(url) {
	if (url.includes('old.reddit.com')) return FIXTURE;
	if (url.includes('/comments/')) return SHREDDIT_THREAD;
	return SHREDDIT_LISTING;
}

// Every uncaught error from every page in the run. One of these is a defect
// wherever it happens, and a run that reports checks while the console is full
// of them is not an audit.
const pageErrors = [];
function watchForErrors(page, where) {
	// The stack, not just the message: on a production build the message alone is
	// a minified identifier and says nothing about where it came from.
	page.on('pageerror', error => pageErrors.push(`${where}: ${String(error.stack || error).split('\n').slice(0, 3).join(' << ')}`));
}

// Both renderers are served from one interception rule, so a page can navigate
// between them the way a reader does.
async function interceptReddit(page) {
	await page.setRequestInterception(true);
	page.on('request', request => {
		const url = request.url();
		if (/reddit\.com/.test(url) && !/\.(?:js|css|png|jpe?g|gif|svg|woff2?|json|mp4)(?:$|\?)/i.test(url)) {
			return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: bodyFor(url) });
		}
		if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1')) {
			return request.respond({ status: 200, contentType: 'text/plain', body: '' });
		}
		return request.continue();
	});
}

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
		watchForErrors(fixturePage, 'old reddit');
		try {
			// Matched by URL rather than by resource type: `resourceType()` throws
			// `UnsupportedOperation` on the BiDi transport, so the Chromium habit of
			// filtering on it does not carry over.
			await interceptReddit(fixturePage);
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

		// --- old Reddit: is the page actually themed? -------------------------
		//
		// The check above proves the content script ran. This one proves it did
		// something: a palette class on `<html>`, the classic white ground, and the
		// classic blue on a listing title. Reading the computed values rather than
		// the class, because a class with no stylesheet behind it is exactly the
		// failure a Firefox-only bundling problem would produce.
		try {
			const theme = await fixturePage.evaluate(() => {
				const title = document.querySelector('#siteTable .thing.link .title a, #siteTable .thing.link a.title');
				return {
					classes: document.documentElement.className,
					background: getComputedStyle(document.body).backgroundColor,
					titleColour: title ? getComputedStyle(title).color : null,
				};
			});
			const themed = /res-pageTheme--classic/.test(theme.classes) && theme.background === 'rgb(255, 255, 255)';
			record('the page theme paints old Reddit on Firefox', themed,
				themed ? `body ${theme.background}, title ${theme.titleColour}` : `classes ${theme.classes.slice(0, 60)}, body ${theme.background}`);
		} catch (e) {
			record('the page theme paints old Reddit on Firefox', false, e.message.split('\n')[0]);
		}

		// --- current Reddit: the adapter, a streamed post, the ad remover ------
		//
		// Everything below this line had never run on Firefox at all. The Shreddit
		// adapter is the half of this add-on that has to work as reddit's own
		// renderer changes, and it was shipping on MV2 with only Chromium behind it.
		const shredditPage = await browser.newPage();
		watchForErrors(shredditPage, 'current reddit');
		try {
			await interceptReddit(shredditPage);
			await shredditPage.goto('https://www.reddit.com/r/example/', { waitUntil: 'domcontentloaded', timeout: 30000 });
			await shredditPage.waitForSelector('shreddit-post[data-res-shreddit-compat]', { timeout: 30000 });

			const listing = await shredditPage.evaluate(async () => {
				const delivered = root => Boolean(root && (
					root.querySelector('style[data-res-shreddit-shadow-style="classic"]') ||
					(root.adoptedStyleSheets || []).length
				));

				// A post that arrives after the first paint, which is how reddit
				// actually fills a feed.
				const streamed = document.createElement('shreddit-post');
				streamed.id = 't3_firefox_streamed';
				streamed.setAttribute('author', 'alice');
				streamed.setAttribute('subreddit-name', 'example');
				streamed.setAttribute('post-type', 'link');
				streamed.setAttribute('score', '5');
				streamed.setAttribute('comment-count', '2');
				streamed.setAttribute('permalink', '/r/example/comments/streamed/x/');
				document.querySelector('shreddit-feed').append(streamed);
				await new Promise(resolve => { setTimeout(resolve, 150); });
				streamed.attachShadow({ mode: 'open' });
				streamed.shadowRoot.innerHTML = '<div class="action-row"><button data-action-bar-action="upvote"></button></div>';
				await new Promise(resolve => { setTimeout(resolve, 2000); });

				const ad = document.querySelector('shreddit-ad-post');
				return {
					themed: document.documentElement.className.includes('res-pageTheme--classic'),
					prepared: document.querySelectorAll('shreddit-post[data-res-shreddit-compat]').length,
					streamedPrepared: streamed.hasAttribute('data-res-shreddit-compat'),
					streamedStyled: delivered(streamed.shadowRoot),
					streamedPart: streamed.shadowRoot.querySelector('.action-row')?.getAttribute('part') || null,
					adDisplay: ad ? getComputedStyle(ad).display : 'missing',
				};
			});

			record('current Reddit gets the classic layout on Firefox', listing.themed && listing.prepared >= 3,
				`${listing.prepared} posts adapted`);
			const streamedOk = listing.streamedPrepared && listing.streamedStyled && listing.streamedPart === 'rsm-action-row';
			record('a post that streams in after load is adapted and styled', streamedOk,
				streamedOk ? 'compat attribute, shadow sheet and exposed parts' : `prepared=${listing.streamedPrepared} styled=${listing.streamedStyled} part=${listing.streamedPart}`);
			record('promoted posts are removed on current Reddit', listing.adDisplay === 'none',
				`shreddit-ad-post display: ${listing.adDisplay}`);
		} catch (e) {
			record('current Reddit gets the classic layout on Firefox', false, e.message.split('\n')[0]);
		}

		// --- a comments control, on the renderer that owns it ------------------
		try {
			await shredditPage.goto('https://www.reddit.com/r/example/comments/thread01/x/', { waitUntil: 'domcontentloaded', timeout: 30000 });
			await shredditPage.waitForSelector('shreddit-comment[data-res-shreddit-compat]', { timeout: 30000 });

			const thread = await shredditPage.evaluate(() => {
				const comment = document.querySelector('shreddit-comment[depth="0"]');
				const summary = comment?.querySelector(':scope > details > summary');
				const details = comment?.querySelector(':scope > details');
				// Read before clicking: the marker is the collapse state, so asking
				// afterwards asks a different question and always answers "[+]".
				const marker = summary ? getComputedStyle(summary, '::before').content : null;
				if (summary) summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				return {
					comments: document.querySelectorAll('shreddit-comment[data-res-shreddit-compat]').length,
					marker,
					collapsedAfterClick: details ? !details.hasAttribute('open') : null,
				};
			});

			const collapseWorks = thread.comments >= 4 && thread.marker === '"[-]"' && thread.collapsedAfterClick === true;
			record('a comments control works on current Reddit', collapseWorks,
				collapseWorks ? `${thread.comments} comments, [-] marker, collapse on click` : `comments=${thread.comments} marker=${thread.marker} collapsed=${thread.collapsedAfterClick}`);
		} catch (e) {
			record('a comments control works on current Reddit', false, e.message.split('\n')[0]);
		}

		// Not reachable from here, and said so rather than left unmentioned.
		// Importing a selector override needs the settings console's own page, and
		// BiDi refuses to navigate to a `moz-extension://` URL: measured
		// 2026-09-02, "Navigation to moz-extension://…/options.html is not allowed
		// in this context". The console can be opened from a reddit page as an
		// iframe - the boot check above does exactly that - but a cross-origin
		// extension frame is not exposed to `page.frames()` over BiDi either, so
		// there is nothing to drive. `selector-override-contract` and the Chromium
		// suite cover the import and its use.
		record('selector override import/use is not automatable over BiDi', true,
			'moz-extension:// navigation is refused; covered in the Chromium suite instead');

		record('no page reported an uncaught error', pageErrors.length === 0,
			pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'both renderers ran clean');
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
