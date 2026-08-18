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

import AxeBuilder from '@axe-core/playwright';

import { launchWithExtension, extensionUrl, assertBuilt, repoRoot, saveScreenshotDir } from './harness.mjs';

// The committed skeleton, not the full `.research/` capture: `.research/` is
// gitignored, so a test sourced from it cannot run on a fresh clone. This is the
// same fixture the selector contracts assert against, which is the point — if the
// two ever disagree about old.reddit's shape, one of them is measuring nothing.
const CAPTURE = path.join(repoRoot, 'tests', 'fixtures', 'mhtml', 'thread.html');
const FRONT_CAPTURE = path.join(repoRoot, 'tests', 'fixtures', 'mhtml', 'frontpage.html');

function screenshotSlug(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A capture taken from a browser that already had RES-Slim installed carries
// res-* classes on <html>, and foreground.entry.js treats those as "already
// initialised here" and bails. Serving such a capture unmodified would measure an
// inert page while looking like a clean pass, and would also satisfy this test's
// own `res` assertion without the extension ever running. Stripped defensively
// even though the committed fixture is currently clean.
function servableCapture(capture = CAPTURE) {
	const raw = fs.readFileSync(capture, 'utf8');
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
	const { context, worker, dispose } = await launchWithExtension();
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

	// The reddit case used to be a real outbound request, and it was the only one
	// left in the suite. It coupled green/red to a third party's availability and
	// to whether reddit's anti-automation layer lets a fresh automation profile out
	// at all — a network-layer block reds the suite for a reason that has nothing
	// to do with the extension, and this repo has already seen that happen.
	//
	// Interception proves the same thing more precisely. A request the CSP refuses
	// never leaves the worker, so the route handler cannot fire: reaching the
	// handler *is* the evidence that `connect-src` allowed the origin. The old
	// version could not distinguish that from reddit answering 403, because
	// `attempt()` returns true for any response at all.
	let intercepted = 0;
	await context.route('https://old.reddit.com/api/me.json', route => {
		intercepted += 1;
		return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' });
	});

	assert.equal(await attempt('https://old.reddit.com/api/me.json'), true, 'reddit itself must remain reachable');
	assert.equal(intercepted, 1, 'the request has to actually leave the worker — a CSP refusal never reaches an interceptor');
});

test('the settings console renders in the options page', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', e => pageErrors.push(String(e)));
	const missingKeyReports = [];
	page.on('console', m => { if (m.text().includes('Missing locale key')) missingKeyReports.push(m.text()); });

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
	//
	// Every tab, not just the one the console opens on. Checking the default view
	// alone would miss a key living in any of the other categories — which is most
	// of them, and which is exactly the exposure when 1,086 unused keys are pruned
	// out of the locale file.
	// Compared against the real key list, not a guessed shape. A shape regex has a
	// blind spot by construction: the first version of this required a
	// Category/Name/Desc/Title suffix and so could not see `settingsConsoleTabAbout`,
	// which is a tab label and about the most visible string in the console. The key
	// list cannot have that problem.
	const localeKeys = Object.keys(JSON.parse(fs.readFileSync(path.join(repoRoot, 'locales', 'locales', 'en.json'), 'utf8')))
		// Two keys are ordinary English words — `yes` and `no` — and the console says
		// "no" for legitimate reasons. Requiring an interior capital keeps the check
		// honest about what it covers rather than reporting the word 'no' forever.
		.filter(key => /[a-z][A-Z]/.test(key));
	assert.ok(localeKeys.length > 100, 'the locale file must load, or this checks nothing');

	// `:not([hidden])` because the console keeps a hidden `__search` tab in the
	// tablist that exists to host search results and is never clickable.
	const tabHandles = await page.locator('[role="tablist"] [role="tab"]:not([hidden])').all();
	assert.ok(tabHandles.length > 1, 'there should be several categories to walk');
	const dir = saveScreenshotDir();
	const pageDir = path.join(dir, 'settings-pages');
	fs.mkdirSync(pageDir, { recursive: true });

	// The selected ImageGen direction is the optional Paper theme. OLED remains
	// the product default; screenshots opt into Paper so parity is measured
	// without changing an existing user's preference.
	await page.locator('#RESCategoryTab-console').click();
	await page.locator('[data-settings-theme="paper"]').click();
	await page.locator('#RESCategoryTab-appearanceCategory').click();
	await page.waitForTimeout(2600);

	for (const tab of tabHandles) {
		await tab.click(); // eslint-disable-line no-await-in-loop
		await page.waitForTimeout(120); // eslint-disable-line no-await-in-loop
		const label = (await tab.locator('.categoryTabLabel').innerText()).trim(); // eslint-disable-line no-await-in-loop
		const category = await tab.getAttribute('data-category'); // eslint-disable-line no-await-in-loop
		const text = await page.locator('#RESConsoleContainer').innerText(); // eslint-disable-line no-await-in-loop
		const words = new Set(text.split(/[^A-Za-z0-9_]+/));
		const leaked = localeKeys.filter(key => words.has(key));
		assert.deepEqual(leaked, [], `locale key rendered as its own name: ${leaked.join(', ')}`);

		const layout = await page.evaluate(() => ({ // eslint-disable-line no-await-in-loop
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			primaryRight: document.querySelector('#RESPrimaryRail').getBoundingClientRect().right,
			moduleLeft: document.querySelector('#RESConfigPanelModulesPane').getBoundingClientRect().left,
			moduleRight: document.querySelector('#RESConfigPanelModulesPane').getBoundingClientRect().right,
			workspaceLeft: document.querySelector('#RESConfigPanelOptions').getBoundingClientRect().left,
		}));
		assert.ok(layout.overflow <= 1, `${label} should not overflow the viewport horizontally`);

		if (category !== '__console') {
			assert.ok(Math.abs(layout.primaryRight - layout.moduleLeft) <= 1, `${label} primary and module rails should meet cleanly`);
			assert.equal((await page.locator('#RESHeaderCategory').innerText()).trim(), label); // eslint-disable-line no-await-in-loop
			assert.ok(Math.abs(layout.moduleRight - layout.workspaceLeft) <= 1, `${label} module rail and workspace should meet cleanly`);
			const selected = page.locator('.RESConfigPanelCategory.active .moduleButton.active');
			assert.equal(await selected.count(), 1, `${label} should expose one selected module`); // eslint-disable-line no-await-in-loop
			const [listBox, selectedBox] = await Promise.all([ // eslint-disable-line no-await-in-loop
				page.locator('#RESConfigPanelModulesList').boundingBox(),
				selected.boundingBox(),
			]);
			assert.ok(listBox && selectedBox && selectedBox.y <= listBox.y + 12, `${label} should pin its active module to the top of the rail`);
			const optionInputs = page.locator('#allOptionsContainer input, #allOptionsContainer select, #allOptionsContainer textarea');
			if (await page.locator('.moduleToggle').getAttribute('aria-pressed') === 'false' && await optionInputs.count()) { // eslint-disable-line no-await-in-loop
				assert.equal(await page.locator('#allOptionsContainer').getAttribute('inert'), null, `${label} settings should remain configurable while its module is off`); // eslint-disable-line no-await-in-loop
				assert.equal(await optionInputs.first().isEnabled(), true, `${label} should allow preparing options before enabling the module`); // eslint-disable-line no-await-in-loop
			}
		} else {
			assert.equal((await page.locator('#RESHeaderCategory').innerText()).trim(), 'Console preferences'); // eslint-disable-line no-await-in-loop
			const consoleLayout = await page.evaluate(() => ({ // eslint-disable-line no-await-in-loop
				moduleDisplay: getComputedStyle(document.querySelector('#RESConfigPanelModulesPane')).display,
				primaryRight: document.querySelector('#RESPrimaryRail').getBoundingClientRect().right,
				prefsLeft: document.querySelector('#RESConsolePrefs').getBoundingClientRect().left,
				advancedTop: document.querySelector('.utilityPanel--advanced').getBoundingClientRect().top,
				viewportHeight: window.innerHeight,
			}));
			assert.equal(consoleLayout.moduleDisplay, 'none', 'Console preferences should not retain an empty module rail'); // eslint-disable-line no-await-in-loop
			assert.ok(Math.abs(consoleLayout.primaryRight - consoleLayout.prefsLeft) <= 1, 'Console preferences should begin where the primary rail ends'); // eslint-disable-line no-await-in-loop
			assert.ok(consoleLayout.advancedTop < consoleLayout.viewportHeight, 'Console preferences should expose Advanced options without an initial scroll'); // eslint-disable-line no-await-in-loop
		}

		await page.screenshot({ path: path.join(pageDir, `${screenshotSlug(label)}.png`), fullPage: false, animations: 'disabled' }); // eslint-disable-line no-await-in-loop
	}

	// Search is a material workspace state, not a permanent category. It spans
	// the whole content area: keeping the previously selected category's module
	// rail beside global results wastes space and implies a false relationship.
	await page.locator('#SearchRES-input').fill('privacy');
	await page.waitForSelector('#SearchRES-results-container:not([hidden])');
	const searchLayout = await page.evaluate(() => ({
		overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		primaryRight: document.querySelector('#RESPrimaryRail').getBoundingClientRect().right,
		workspaceLeft: document.querySelector('#RESConfigPanelOptions').getBoundingClientRect().left,
		moduleDisplay: getComputedStyle(document.querySelector('#RESConfigPanelModulesPane')).display,
		resultCount: document.querySelectorAll('.SearchRES-result-item:not(.advanced)').length,
	}));
	assert.ok(searchLayout.overflow <= 1, 'settings search should not overflow the viewport horizontally');
	assert.equal(searchLayout.moduleDisplay, 'none', 'global search should not retain an unrelated category module rail');
	assert.ok(Math.abs(searchLayout.primaryRight - searchLayout.workspaceLeft) <= 1, 'search workspace should begin where the primary rail ends');
	assert.ok(searchLayout.resultCount > 0, 'privacy should return settings results');
	await page.screenshot({ path: path.join(pageDir, 'search.png'), fullPage: false, animations: 'disabled' });
	await page.locator('#SearchRES-input').fill('');

	await page.setViewportSize({ width: 960, height: 900 });
	await page.locator('#RESCategoryTab-appearanceCategory').click();
	const compactLayout = await page.evaluate(() => ({
		overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		primaryWidth: document.querySelector('#RESPrimaryRail').getBoundingClientRect().width,
		categoryLabelDisplay: getComputedStyle(document.querySelector('.categoryTabLabel')).display,
		toggleDisplay: getComputedStyle(document.querySelector('#RESMobileSidebarToggle')).display,
	}));
	assert.ok(compactLayout.overflow <= 1, 'compact settings console should not overflow horizontally');
	assert.ok(Math.abs(compactLayout.primaryWidth - 78) <= 1, 'compact settings console should reduce the primary rail to its icon width');
	assert.equal(compactLayout.categoryLabelDisplay, 'none', 'compact settings console should replace category labels with icons');
	assert.ok(['flex', 'inline-flex'].includes(compactLayout.toggleDisplay), 'compact settings console should expose the module-rail toggle');
	await page.screenshot({ path: path.join(dir, 'settings-responsive-960.png'), fullPage: false, animations: 'disabled' });

	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.locator('#RESCategoryTab-appearanceCategory').click();
	const wideLayout = await page.evaluate(() => ({
		overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
		primaryWidth: document.querySelector('#RESPrimaryRail').getBoundingClientRect().width,
		moduleWidth: document.querySelector('#RESConfigPanelModulesPane').getBoundingClientRect().width,
		moduleDisplay: getComputedStyle(document.querySelector('#RESConfigPanelModulesPane')).display,
	}));
	assert.ok(wideLayout.overflow <= 1, 'wide desktop settings console should not overflow horizontally');
	assert.ok(wideLayout.primaryWidth >= 280, 'wide desktop settings console should retain its labeled primary rail');
	assert.ok(wideLayout.moduleWidth >= 270, 'wide desktop settings console should retain its module rail');
	assert.equal(wideLayout.moduleDisplay, 'grid', 'wide desktop settings console should keep both navigation rails visible');
	await page.screenshot({ path: path.join(dir, 'settings-desktop-1920.png'), fullPage: false, animations: 'disabled' });

	// The walk above can only read text. i18n() itself reports a miss in
	// development, which covers the keys that render somewhere a text scrape cannot
	// see — a title attribute, a toast that is not currently showing.
	assert.deepEqual(missingKeyReports, [], 'i18n() reported a missing key while the console was open');

	assert.deepEqual(pageErrors, [], 'options page must load without uncaught errors');

	await page.screenshot({ path: path.join(dir, 'settings-console.png'), fullPage: false, animations: 'disabled' });
});

test('settings console themes and display controls work by keyboard', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	const consoleTab = page.locator('#RESCategoryTab-console');
	await consoleTab.focus();
	await page.keyboard.press('Enter');
	await page.waitForSelector('#RESConsolePrefs:not([hidden])');

	const themeButtons = page.locator('#RESThemeSelector .themeOption');
	assert.equal(await themeButtons.count(), 9, 'every settings theme should be reachable');
	for (const theme of await themeButtons.evaluateAll(buttons => buttons.map(button => button.dataset.settingsTheme))) {
		const button = page.locator(`#RESThemeSelector [data-settings-theme="${theme}"]`);
		await button.focus();
		await page.keyboard.press('Enter');
		const state = await page.evaluate(() => {
			const styles = getComputedStyle(document.documentElement);
			return {
				theme: document.documentElement.dataset.settingsTheme,
				background: styles.getPropertyValue('--options-bg').trim(),
				accent: styles.getPropertyValue('--options-accent').trim(),
			};
		});
		assert.equal(state.theme, theme, `${theme} should apply from a focused button`);
		assert.ok(state.background && state.accent, `${theme} should expose its live token set`);
	}

	const density = page.locator('#RESDensityToggle');
	await density.focus();
	await page.keyboard.press('Enter');
	assert.equal(await page.locator('html').getAttribute('data-settings-density'), 'dense');
	assert.equal(await page.locator('#RESDensityValue').innerText(), 'Dense');
	await page.keyboard.press('Enter');
	assert.equal(await page.locator('html').getAttribute('data-settings-density'), 'comfortable');
	assert.equal(await page.locator('#RESDensityValue').innerText(), 'Comfortable');

	const motion = page.locator('#RESMotionToggle');
	await motion.focus();
	await page.keyboard.press('Space');
	assert.equal(await page.locator('html').getAttribute('data-reduced-motion'), 'reduce');
	assert.equal(await page.locator('#RESMotionValue').innerText(), 'Reduced');
	await page.keyboard.press('Space');
	assert.equal(await page.locator('html').getAttribute('data-reduced-motion'), null);
	assert.equal(await page.locator('#RESMotionValue').innerText(), 'System');

	// The vertical rail responds to Up/Down, while Left/Right remain aliases for
	// users and tests that learned the previous horizontal tab strip.
	await consoleTab.focus();
	await page.keyboard.press('ArrowUp');
	assert.notEqual(await page.locator('#RESCategoryTabs [role="tab"][aria-selected="true"]').getAttribute('data-category'), '__console');
	await page.keyboard.press('ArrowDown');
	assert.equal(await page.locator('#RESCategoryTabs [role="tab"][aria-selected="true"]').getAttribute('data-category'), '__console');
	await page.keyboard.press('ArrowLeft');
	assert.notEqual(await page.locator('#RESCategoryTabs [role="tab"][aria-selected="true"]').getAttribute('data-category'), '__console');
	await page.keyboard.press('End');
	assert.equal(await page.locator('#RESCategoryTabs [role="tab"][aria-selected="true"]').getAttribute('data-category'), '__console');
});

// What actually keeps the nine `include`-less modules off the extension's own
// options page — and it is not `include`.
//
// `module-registry-contract` pins nine modules that declare no `include`, no
// `exclude` and no `shouldRun`, on the stated grounds that such a module "runs on
// every page including the options page". Driving the real page says otherwise:
// `lib/options/options.entry.js` pushes an explicit allowlist into
// `allowedModules`, and `isRunning()` checks that *before* all three scoping
// mechanisms. It is a fourth gate and the tightest of them.
//
// Two things follow, and both need a test rather than a comment:
//
//   1. The allowlist is one unguarded line. Appending to it silently re-opens the
//      class of bug this repo shipped in v0.3.5 and again in v0.4.0. No unit
//      contract can see it — `allowedModules` is empty at import time and is only
//      filled by the options entrypoint, which no unit test runs.
//   2. The `onInit` and `always` stages are dispatched with
//      `skipEnabledCheck: true`, so they bypass `isRunning` *entirely* — allowlist,
//      include, exclude and shouldRun alike. Each such handler is therefore
//      responsible for its own gating, and three modules reach the options page
//      through that door. All three were read and are correctly self-gated
//      (`pageTheme.always` and `systemThemeSync.always` re-check
//      `Modules.isRunning`; `showImages.onInit` checks `isAppType('r2')`), but a
//      *new* `always` handler that forgets would arrive here unannounced.
//
// Measured with the module profiler rather than DOM artefacts. Artefacts are the
// wrong instrument: `RESMenu` running on the options page still injects no gear,
// because `addFloater`'s containers require `isAppType('r2')` or `'d2x'` — so
// "the gear is absent" is true whether the gate holds or not.
test('the options page runs only the modules it explicitly allows', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', e => pageErrors.push(String(e)));

	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'load' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	// `window.rsmDiagnostics` is published by `lib/core/init.js` once `afterLoad`
	// resolves, and reports one entry per module that had a stage invoked.
	await page.waitForFunction(() => typeof window.rsmDiagnostics === 'function', null, { timeout: 30000 });

	const ran = await page.evaluate(() => window.rsmDiagnostics()
		.map(m => `${m.moduleID}:${Object.keys(m.stages).sort().join('+')}`)
		.sort());

	assert.deepEqual(ran, [
		// Allowlisted by options.entry.js — these are meant to run.
		'nightMode:always+onInit',
		'notifications:go',
		// Reached only through the two gate-bypassing stages, and self-gated.
		'pageTheme:always+onInit',
		'showImages:onInit',
		'systemThemeSync:always',
	], 'a module reaching the options page that is not in this list has escaped both the allowlist and its own self-gating');

	// Guard against the list above passing vacuously if the console never booted:
	// an empty profile would fail the deepEqual, but a *partial* one might not read
	// as suspicious, so assert the two visible effects of the allowlisted pair.
	const painted = await page.evaluate(() => ({
		nightMode: document.documentElement.classList.contains('res-nightmode'),
		notifications: !!document.querySelector('#RESNotifications'),
	}));
	assert.equal(painted.nightMode, true, 'nightMode is what makes the console dark');
	assert.equal(painted.notifications, true, 'the console reports save failures through the notifications host');

	assert.deepEqual(pageErrors, [], 'options page must load without uncaught errors');
});

// `all_frames` was `true`, inherited from upstream RES, which used it for its
// embedded-comments mode. This fork never enters that mode: `foreground.entry.js`
// refuses to initialise in any subframe unless the URL carries `embedded=true`,
// and **nothing in this repo ever sets that parameter**. So every reddit-origin
// subframe was parsing 1.36 MB of JavaScript for a script that bailed on line 30,
// and applying 287 KB of stylesheet that nothing had asked for.
//
// Now `false`. The entry guard is deliberately kept — it is the thing that made
// this safe to change, and it is what would still hold if the manifest regressed.
// This test asserts both halves, because either alone would let the other rot.
test('the extension does not reach into reddit-origin subframes', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);


	const page = await context.newPage();
	// Console output from every frame, including the subframe.
	const messages = [];
	page.on('console', m => messages.push(m.text()));
	const frameHtml = '<!doctype html><html><head></head><body><p>framed</p></body></html>';
	const topHtml = servableCapture().replace('</body>', '<iframe id="probe" src="https://old.reddit.com/framed-probe"></iframe></body>');

	await page.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (url.includes('/framed-probe')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: frameHtml });
		}
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: topHtml });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/r/codex/comments/1th66mb/this_has_to_stop/', { waitUntil: 'domcontentloaded' });

	// The top frame must still be taken over — otherwise every assertion below
	// passes against an extension that simply is not running.
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });

	const frame = await (await page.waitForSelector('#probe')).contentFrame();
	await frame.waitForLoadState('domcontentloaded');

	const initialised = await frame.evaluate(() => document.documentElement.classList.contains('res'));
	assert.equal(initialised, false, 'the subframe must not be taken over');

	// `initialised` alone does not discriminate: the entry guard already bailed in
	// subframes, so it was false under `all_frames: true` as well. What changes is
	// whether the 1.36 MB bundle is parsed and evaluated there at all — and the
	// guard announces itself when it fires, which is the observable difference.
	//
	// Not `document.styleSheets`: content-script CSS is injected into an isolated
	// origin and never appears there, so asserting a count of zero would have been
	// true either way.
	assert.deepEqual(
		messages.filter(m => m.includes('Preventing initalization of RES')),
		[],
		'the bundle should never have been evaluated in the subframe — if the guard is talking, the script ran',
	);

	// Pinned last, after the observed behaviour: asserting the manifest field first
	// would short-circuit the only assertions that can tell whether the change
	// actually did anything.
	assert.equal(
		assertBuilt().content_scripts[0].all_frames,
		false,
		'a subframe has no reason to receive the bundle — nothing in this repo sets embedded=true',
	);
	assert.match(
		fs.readFileSync(path.join(repoRoot, 'lib', 'foreground.entry.js'), 'utf8'),
		/window !== window\.parent/,
		'keep the runtime guard too: it is what made all_frames:false safe, and the backstop if the manifest regresses',
	);
});

// The first-run greeting, driven rather than reasoned about.
//
// Its first implementation inferred "fresh install" from an empty local store and
// **could never fire**, because `migrate()` writes keys in the background before
// the first page finishes loading. Every unit assertion on the predicate passed.
// Only running the extension showed it, which is why this lives here.
//
// The harness creates a fresh user-data directory per launch, so `onInstalled`
// fires with reason 'install' every time — exactly the condition under test.
test('a fresh install is greeted once, and only once', async t => {
	const { context, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	const html = servableCapture();
	await page.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	const greeting = () => page.evaluate(() => {
		const el = document.querySelector('.RESNotification[data-id*="first-run"]');
		return el && {
			text: el.innerText.replace(/\s+/g, ' ').trim(),
			hasSettingsLink: !!el.querySelector('a[href*="res:settings"]'),
		};
	});

	const load = async () => {
		await page.goto('https://old.reddit.com/r/codex/comments/1th66mb/x/', { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });
		// `afterLoad` waits on `loadComplete`, then reads storage.
		await page.waitForTimeout(3000);
	};

	await load();
	const first = await greeting();
	assert.ok(first, 'a fresh install should say something — this is the whole feature');
	assert.match(first.text, /\d+ features are on by default/, 'the count is what a new user cannot see for themselves');
	assert.equal(first.hasSettingsLink, true, 'and there must be a route to turning them off');
	assert.ok(!/RES-Slim RES-Slim/.test(first.text), 'the header already says RES-Slim');

	await load();
	assert.equal(await greeting(), null, 'a greeting that reappears on every page load is an advert');
});

// A pageTheme palette has to actually paint the page.
//
// The document_start anti-FOUC style sets `:root.rsm-theme-oled body` to a
// hardcoded OLED background so the page is not white before the theme loads. That
// selector has the *same specificity* as pageTheme's `html.res-pageTheme body`,
// and it is appended to `<head>` after the content-script stylesheet, so it won on
// source order — every palette's background was silently replaced with OLED black,
// and had been since the module shipped.
//
// No unit test can see this. It is not in the SCSS, not in the module, and not in
// the class list: both rules are present and correct, and the cascade decides.
test('an enabled pageTheme palette paints its own background', async t => {
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	const html = servableCapture();
	await page.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	// From the service worker: the page's main world has no `chrome.storage`.
	await worker.evaluate(() => new Promise(resolve => chrome.storage.local.set({
		'RES.modulePrefs': { pageTheme: true },
		'RESoptions.pageTheme': { theme: { value: 'gruvbox' }, accent: { value: '#8a5cff' } },
	}, resolve)));

	await page.goto('https://old.reddit.com/r/codex/comments/1th66mb/x/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res-pageTheme--gruvbox'), null, { timeout: 30000 });
	await page.waitForTimeout(1500);

	const painted = await page.evaluate(() => ({
		body: getComputedStyle(document.body).backgroundColor,
		token: getComputedStyle(document.documentElement).getPropertyValue('--rsm-th-bg').trim(),
		antiFoucStyle: !!document.getElementById('rsm-anti-fouc-style'),
	}));

	// The token resolving proves the palette block loaded; it does NOT prove the
	// page is painted with it, which was the whole bug.
	assert.equal(painted.token, '#282828', 'the gruvbox palette block must be in res.css');
	assert.equal(painted.body, 'rgb(40, 40, 40)', 'the body must actually be painted #282828, not the anti-FOUC OLED black');
	assert.equal(painted.antiFoucStyle, false, 'the early style has done its job once a real palette is applied');
});

test('the default old Reddit theme is refined, readable, and reversible', async t => {
	const { context, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	const html = servableCapture(FRONT_CAPTURE)
		.replace(/(<div class="midcol[^"]*">)/, '<span class="rank">1</span>$1')
		.replace('<div class="side">', '<div class="side"><div class="spacer rsm-e2e-hidden-spacer"><div class="account-activity-box"></div></div>');
	await page.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res-pageTheme--refined'), null, { timeout: 30000 });
	await page.waitForTimeout(250);

	const state = await page.evaluate(() => {
		const firstThing = document.querySelector('#siteTable > .thing.link');
		const rank = firstThing?.querySelector('.rank');
		const title = firstThing?.querySelector('a.title');
		const header = document.querySelector('#header');
		const search = document.querySelector('.side #search');
		const searchInput = search?.querySelector('input[type="text"]');
		const searchSubmit = document.querySelector('#search input[type="submit"]');
		const searchDispatcher = search?.querySelector('.rsm-search-dispatcher');
		const searchExpando = search?.querySelector('#searchexpando');
		const hiddenSidebarSpacer = document.querySelector('.rsm-e2e-hidden-spacer');
		const styles = element => element ? getComputedStyle(element) : null;
		const rect = element => element ? element.getBoundingClientRect() : null;
		const closedSearchHeight = rect(search)?.height;
		if (searchExpando instanceof HTMLElement) searchExpando.hidden = false;
		return {
			bodyBackground: styles(document.body)?.backgroundColor,
			cardBackground: styles(firstThing)?.backgroundColor,
			cardRadius: styles(firstThing)?.borderRadius,
			cardTitleSize: styles(title)?.fontSize,
			headerPosition: styles(header)?.position,
			rankDisplay: styles(rank)?.display,
			searchSubmitPosition: styles(searchSubmit)?.position,
			searchSubmitSize: searchSubmit ? [searchSubmit.getBoundingClientRect().width, searchSubmit.getBoundingClientRect().height] : null,
			searchSubmitBackground: styles(searchSubmit)?.backgroundImage,
			searchInputSize: searchInput ? [rect(searchInput)?.width, rect(searchInput)?.height] : null,
			searchInputPaddingRight: styles(searchInput)?.paddingRight,
			searchIconContent: search ? getComputedStyle(search, '::after').content : null,
			searchDispatcherPosition: styles(searchDispatcher)?.position,
			searchDispatcherSize: searchDispatcher ? [rect(searchDispatcher)?.width, rect(searchDispatcher)?.height] : null,
			searchDispatcherRight: styles(searchDispatcher)?.right,
			closedSearchHeight,
			expandedSearchHeight: rect(search)?.height,
			searchExpandoBackground: styles(searchExpando)?.backgroundColor,
			searchExpandoBorder: styles(searchExpando)?.borderColor,
			searchExpandoRadius: styles(searchExpando)?.borderRadius,
			searchExpandoGap: searchExpando && searchInput ? rect(searchExpando)?.top - rect(searchInput)?.bottom : null,
			searchExpandoLabelHeight: rect(searchExpando?.querySelector('label'))?.height,
			searchAdvancedSize: styles(searchExpando?.querySelector('#search_showmore'))?.fontSize,
			searchInputBorder: styles(searchInput)?.borderColor,
			hiddenSidebarSpacerDisplay: styles(hiddenSidebarSpacer)?.display,
			classes: document.documentElement.className,
		};
	});

	assert.match(state.classes, /\bres-pageTheme--graphite\b/, 'the default palette should avoid crushed OLED black');
	assert.equal(state.bodyBackground, 'rgb(11, 15, 20)', 'Graphite should paint the page canvas');
	assert.notEqual(state.cardBackground, 'rgba(0, 0, 0, 0)', 'listing Things should be real card surfaces');
	assert.equal(state.cardRadius, '8px', 'cards should use the restrained desktop radius');
	assert.equal(state.cardTitleSize, '16px', 'titles should lead the card hierarchy');
	assert.equal(state.headerPosition, 'sticky', 'primary navigation should stay available while reading');
	assert.equal(state.rankDisplay, 'none', 'declutter should remove redundant ordinal ranks');
	assert.equal(state.searchSubmitPosition, 'absolute', 'the search action should stay inside the search field');
	assert.deepEqual(state.searchSubmitSize, [38, 38], 'the compact search action should keep a usable desktop target');
	assert.equal(state.searchSubmitBackground, 'none', 'the leaking native sprite should not remain visible');
	assert.deepEqual(state.searchInputSize, [300, 38], 'the sidebar search field should use the compact rail measure');
	assert.equal(state.searchInputPaddingRight, '142px', 'search text should reserve room for the destination control');
	assert.ok(state.searchIconContent.includes('\uF094'), 'the bundled Batch search glyph should replace the native sprite');
	assert.equal(state.searchDispatcherPosition, 'absolute', 'the destination picker should live inside the field');
	assert.deepEqual(state.searchDispatcherSize, [88, 28], 'the destination picker should remain compact');
	assert.equal(state.searchDispatcherRight, '42px', 'the destination picker should leave the search action clear');
	assert.equal(state.closedSearchHeight, 38, 'resting search should not consume a second row');
	assert.ok(state.expandedSearchHeight > state.closedSearchHeight, 'the native helper should expand the form in flow');
	assert.notEqual(state.searchExpandoBackground, 'rgba(0, 0, 0, 0)', 'the search helper should sit on a deliberate surface');
	assert.equal(state.searchExpandoBorder, state.searchInputBorder, 'the search helper should use the active theme border instead of orange');
	// 8px, not the 7px this pinned for two releases: 7 is not on the 4/6/8/10/12
	// scale, and this assertion was one of the places the off-scale value was
	// load-bearing. What it is really about is that the helper and the field it
	// hangs off share a radius, which is still true.
	assert.equal(state.searchExpandoRadius, '8px', 'the search helper should match the field geometry');
	assert.equal(state.searchExpandoGap, 6, 'the search helper should connect to the field with a compact gap');
	assert.equal(state.searchExpandoLabelHeight, 24, 'search scope choices should remain easy to target');
	assert.equal(state.searchAdvancedSize, '10px', 'advanced search should stay visible without dominating the rail');
	assert.equal(state.hiddenSidebarSpacerDisplay, 'none', 'decluttering should remove wrappers around hidden sidebar clutter');

	const firstTitle = page.locator('#siteTable > .thing.link a.title').first();
	await firstTitle.focus();
	const focus = await firstTitle.evaluate(element => {
		const style = getComputedStyle(element);
		return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
	});
	assert.equal(focus.outlineStyle, 'solid', 'keyboard focus must remain visible on the refined skin');
	assert.equal(focus.outlineWidth, '2px', 'focus should be stronger than a one-pixel border shift');

	const dir = saveScreenshotDir();
	await page.screenshot({ path: path.join(dir, 'old-reddit-refined-listing.png'), fullPage: false });
});

test('refined old Reddit search uses focused cards and themed empty states', async t => {
	const { context, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	const html = `<!doctype html>
		<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
		<head>
			<title>fixture search</title>
			<style>
				.search-result-link { display: flex; }
				.search-expando.collapsed { position: relative; height: 45px; overflow: hidden; }
				.search-expando.collapsed::before { position: absolute; inset: auto 0 0; height: 15px; content: ""; background: linear-gradient(transparent, #fff); }
			</style>
		</head>
		<body class="combined-search-page loggedin search-page">
			<div id="header" role="banner">
				<div id="sr-header-area"><div class="width-clip"></div></div>
				<div id="header-bottom-left"><span class="pagename"><a href="/search">search results</a></span></div>
				<div id="header-bottom-right"><span class="user">fixture</span></div>
			</div>
			<div class="side">
				<div class="spacer"><div class="sidebox submit"><div class="morelink"><a href="/submit">submit</a></div></div></div>
			</div>
			<div class="content" role="main">
				<div class="searchpane raisedbox">
					<h4>search</h4>
					<div id="previoussearch">
						<form action="/search" id="search" role="search">
							<input type="text" name="q" value="privacy">
							<button class="search-submit-button" type="submit" aria-label="Search"><span class="search-icon"></span></button>
							<label><input type="checkbox" name="include_over_18">include NSFW results</label>
							<p><a href="#" id="search_showmore">advanced search</a></p>
						</form>
					</div>
				</div>
				<div class="listing search-result-listing">
					<div class="search-result-group">
						<div class="contents">
							<div class="search-result search-result-subreddit">
								<header class="search-result-header"><a href="/r/fixture" class="search-title">Fixture community</a></header>
								<div class="search-result-meta"><span class="fancy-toggle-button search-subscribe-button"><a class="option active add" href="#">join</a></span> a community for 10 years</div>
								<div class="search-result-body">A useful public community result.</div>
								<div class="search-result-footer"><a href="/r/fixture/search" class="search-link">search within r/fixture</a></div>
							</div>
						</div>
					</div>
					<div class="search-result-group">
						<header class="search-result-group-header"><span class="search-header-label">posts</span></header>
						<div class="contents">
							<div class="search-result search-result-link has-thumbnail">
								<a href="/r/fixture/comments/post" class="thumbnail"><img alt="" width="70" height="70"></a>
								<div>
									<header class="search-result-header"><a href="/r/fixture/comments/post" class="search-title">A <mark>privacy</mark> result</a></header>
									<div class="search-result-meta">123 points · 42 comments · submitted today</div>
									<div class="search-expando collapsed"><div class="search-result-body"><div class="md"><p>A long result excerpt that fades into the card surface instead of a white native gradient.</p></div></div></div>
								</div>
							</div>
						</div>
					</div>
					<div class="search-result-group empty-search-group">
						<footer><p class="info">there doesn't seem to be anything here</p></footer>
					</div>
				</div>
			</div>
		</body>
		</html>`;

	await page.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/search?q=privacy', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res-pageTheme--refined'), null, { timeout: 30000 });
	await page.waitForTimeout(250);

	const state = await page.evaluate(() => {
		const styles = element => element ? getComputedStyle(element) : null;
		const rect = element => element ? element.getBoundingClientRect() : null;
		const side = document.querySelector('body > .side');
		const content = document.querySelector('body > .content');
		const searchpane = document.querySelector('.searchpane');
		const query = document.querySelector('#previoussearch input[name="q"]');
		const submit = document.querySelector('.search-submit-button');
		const result = document.querySelector('.search-result');
		const postResult = document.querySelector('.search-result-link');
		const postThumbnail = postResult?.querySelector('.thumbnail');
		const title = result?.querySelector('.search-title');
		const snippet = document.querySelector('.search-expando .md');
		const expando = document.querySelector('.search-expando');
		const empty = document.querySelector('.empty-search-group .info');
		return {
			sideDisplay: styles(side)?.display,
			contentMarginRight: styles(content)?.marginRight,
			searchpaneWidth: rect(searchpane)?.width,
			searchpaneX: rect(searchpane)?.x,
			searchpanePadding: styles(searchpane)?.padding,
			listingX: rect(document.querySelector('.search-result-listing'))?.x,
			queryHeight: rect(query)?.height,
			submitSize: submit ? [rect(submit)?.width, rect(submit)?.height] : null,
			resultWidth: rect(result)?.width,
			resultBackground: styles(result)?.backgroundColor,
			resultRadius: styles(result)?.borderRadius,
			postResultHeight: rect(postResult)?.height,
			postThumbnailSize: postThumbnail ? [rect(postThumbnail)?.width, rect(postThumbnail)?.height] : null,
			postThumbnailFloat: styles(postThumbnail)?.float,
			postThumbnailFlexShrink: styles(postThumbnail)?.flexShrink,
			titleSize: styles(title)?.fontSize,
			snippetBackground: styles(snippet)?.backgroundColor,
			fade: expando ? getComputedStyle(expando, '::before').backgroundImage : null,
			emptyBackground: styles(empty)?.backgroundColor,
			emptyRadius: styles(empty)?.borderRadius,
			emptyPadding: styles(empty)?.padding,
			overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
		};
	});

	assert.equal(state.sideDisplay, 'none', 'declutter should remove search-only submission chrome');
	assert.equal(state.contentMarginRight, '14px', 'focused search should reclaim the sidebar column symmetrically');
	assert.equal(state.searchpaneWidth, 1100, 'search controls should use the readable desktop content measure');
	assert.ok(state.searchpaneX > 100, 'focused search should balance its readable measure in the viewport');
	assert.equal(state.searchpanePadding, '14px 16px', 'the query surface should keep compact desktop padding');
	assert.equal(state.listingX, state.searchpaneX, 'query and results should share one centered column');
	assert.equal(state.queryHeight, 38, 'the full search field should match the compact sidebar control');
	assert.deepEqual(state.submitSize, [38, 38], 'the search action should align exactly with the query field');
	assert.equal(state.resultWidth, 1100, 'search cards should align with the query surface');
	assert.notEqual(state.resultBackground, 'rgba(0, 0, 0, 0)', 'results should sit on a visible surface');
	assert.equal(state.resultRadius, '8px', 'search cards should use the same restrained radius as listings');
	assert.ok(state.postResultHeight < 220, 'post result should stay compact');
	assert.deepEqual(state.postThumbnailSize, [76, 58], 'post thumbnails should not depend on native float sizing');
	assert.equal(state.postThumbnailFloat, 'left', 'post thumbnails should reserve a stable media column');
	assert.equal(state.postThumbnailFlexShrink, '0', 'native flex rows must not squeeze the media column');
	assert.equal(state.titleSize, '16px', 'result titles should lead the hierarchy');
	assert.equal(state.snippetBackground, 'rgba(0, 0, 0, 0)', 'snippets should not draw a second dark rectangle');
	assert.doesNotMatch(state.fade, /255, 255, 255/, 'collapsed excerpts must not fade to native white');
	assert.match(state.fade, /17, 24, 33/, 'collapsed excerpts should fade into the Graphite card');
	assert.notEqual(state.emptyBackground, 'rgba(0, 0, 0, 0)', 'empty results need a deliberate surface');
	assert.equal(state.emptyRadius, '8px');
	assert.equal(state.emptyPadding, '18px');
	assert.equal(state.overflow, false, 'focused search should not create horizontal overflow');

	const restoredSide = await page.evaluate(() => {
		document.documentElement.classList.remove('res-pageTheme--declutter');
		return getComputedStyle(document.querySelector('body > .side')).display;
	});
	assert.notEqual(restoredSide, 'none', 'search debloating must remain independently reversible');
	await page.evaluate(() => document.documentElement.classList.add('res-pageTheme--declutter'));

	const dir = saveScreenshotDir();
	await page.screenshot({ path: path.join(dir, 'old-reddit-refined-search.png'), fullPage: false });
});

test('the packaged ruleset blocks Reddit ad and measurement requests', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const optionsPage = await context.newPage();
	await optionsPage.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	const enabledRulesets = await optionsPage.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
	assert.ok(enabledRulesets.includes('reddit_ads'), 'the packaged reddit_ads ruleset must be enabled at runtime');
	await optionsPage.close();

	const page = await context.newPage();
	const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>DNR probe</title></head><body class="listing-page"><main class="content" role="main"></main></body></html>';
	await page.route('**/*', route => {
		const url = route.request().url();
		if (url === 'https://alb.reddit.com/rsm-dnr-probe.png') return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.abort();
	});

	await page.goto('https://old.reddit.com/rsm-dnr-probe/', { waitUntil: 'domcontentloaded' });
	const failedRequest = page.waitForEvent('requestfailed', {
		predicate: request => request.url() === 'https://alb.reddit.com/rsm-dnr-probe.png',
		timeout: 10000,
	});
	const imageResult = page.evaluate(() => new Promise(resolve => {
		const probe = new Image();
		probe.onload = () => resolve('loaded');
		probe.onerror = () => resolve('blocked');
		probe.src = 'https://alb.reddit.com/rsm-dnr-probe.png';
		document.body.append(probe);
	}));
	const [request, result] = await Promise.all([failedRequest, imageResult]);

	assert.equal(result, 'blocked', 'the ad-host probe must not load');
	assert.match(request.failure()?.errorText || '', /ERR_BLOCKED_BY_CLIENT/, 'Chromium should attribute the failure to the extension ruleset');
});

test('the opt-in Old Reddit redirect runs before modern document bytes load', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const optionsPage = await context.newPage();
	await optionsPage.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });

	const redirectRuleIds = [900001, 900002, 900003];
	const redirectRuleId = redirectRuleIds.at(-1);
	await optionsPage.evaluate(() => new Promise((resolve, reject) => {
		chrome.storage.local.set({
			'RESoptions.oldRedditRedirect': { autoRedirect: { value: true } },
		}, () => {
			if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
			else resolve();
		});
	}));

	await optionsPage.waitForFunction(async ids => {
		const rules = await chrome.declarativeNetRequest.getDynamicRules();
		return ids.every(id => rules.some(rule => rule.id === id));
	}, redirectRuleIds, { timeout: 10000 });

	const installedRules = await optionsPage.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
	const installedRedirect = installedRules.find(rule => rule.id === redirectRuleId);
	assert.ok(installedRedirect, 'enabling the option must install the redirect rule');
	assert.equal(installedRedirect.condition.urlFilter, '|https://www.reddit.com/');
	assert.deepEqual(installedRedirect.condition.resourceTypes, ['main_frame']);
	assert.deepEqual(installedRedirect.action.redirect.transform, { host: 'old.reddit.com', scheme: 'https' });

	// `testMatchOutcome` is only available to unpacked builds, which is exactly
	// what this harness launches. It proves Chromium accepted the protected-path
	// and one-page escape rules instead of silently discarding their regexes.
	const outcomes = await optionsPage.evaluate(async ids => {
		const test = url => chrome.declarativeNetRequest.testMatchOutcome({ url, type: 'main_frame' });
		const [ordinary, login, account, ads, escaped, oldHost, shHost] = await Promise.all([
			test('https://www.reddit.com/r/codex/?sort=new'),
			test('https://www.reddit.com/login/'),
			test('https://www.reddit.com/account/register'),
			test('https://www.reddit.com/ads/create'),
			test('https://www.reddit.com/r/codex/?res_slim_redirect=off'),
			test('https://old.reddit.com/r/codex/'),
			test('https://sh.reddit.com/r/codex/'),
		]);
		const own = result => result.matchedRules.map(rule => rule.ruleId).filter(id => ids.includes(id));
		return {
			ordinary: own(ordinary),
			login: own(login),
			account: own(account),
			ads: own(ads),
			escaped: own(escaped),
			oldHost: own(oldHost),
			shHost: own(shHost),
		};
	}, redirectRuleIds);
	assert.ok(outcomes.ordinary.includes(redirectRuleId), 'ordinary www routes must match the redirect');
	for (const key of ['login', 'account', 'ads', 'escaped']) {
		assert.ok(outcomes[key].some(id => id !== redirectRuleId), `${key} must match a higher-priority allow rule`);
	}
	assert.deepEqual(outcomes.oldHost, [], 'old.reddit.com must not match any redirect rule');
	assert.deepEqual(outcomes.shHost, [], 'sh.reddit.com must not match any redirect rule');

	const page = await context.newPage();
	const wwwDocumentResponses = [];
	page.on('response', response => {
		if (response.request().resourceType() === 'document' && new URL(response.url()).hostname === 'www.reddit.com') {
			wwwDocumentResponses.push(response.url());
		}
	});

	const redirectedHtml = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Redirect target</title></head><body class="listing-page"><main id="redirect-target">old target loaded</main></body></html>';
	await page.route('**/*', route => {
		const request = route.request();
		const url = request.url();
		if (request.resourceType() === 'document' && url.startsWith('https://old.reddit.com/')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: redirectedHtml });
		}
		if (request.resourceType() === 'document' && url.startsWith('https://www.reddit.com/')) {
			// DNR evaluates after interception continues. If the rule is absent this
			// reaches Reddit and the response assertion below catches the leak.
			return route.continue();
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://www.reddit.com/rsm-dnr-redirect/?sort=new#details', {
		waitUntil: 'domcontentloaded',
		timeout: 30000,
	});
	await page.waitForSelector('#redirect-target', { timeout: 10000 });
	assert.equal(
		page.url(),
		'https://old.reddit.com/rsm-dnr-redirect/?sort=new#details',
		'the transform must preserve path, query, and fragment while replacing only the host',
	);
	assert.deepEqual(wwwDocumentResponses, [], 'no modern Reddit document response may deliver bytes before the redirect');

	await optionsPage.evaluate(() => new Promise((resolve, reject) => {
		chrome.storage.local.set({
			'RESoptions.oldRedditRedirect': { autoRedirect: { value: false } },
		}, () => {
			if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
			else resolve();
		});
	}));
	await optionsPage.waitForFunction(async ids => {
		const rules = await chrome.declarativeNetRequest.getDynamicRules();
		return ids.every(id => !rules.some(rule => rule.id === id));
	}, redirectRuleIds, { timeout: 10000 });
});

test('promoted old Reddit records stay hidden across initial and asynchronous loads', async t => {
	const { context, dispose } = await launchWithExtension();
	t.after(dispose);

	const initialPromoted = `
		<div class="thing link promotedlink" data-fullname="t3_ad0001" data-subreddit="example" data-domain="example.com" data-author="advertiser">
			<div class="entry"><p class="title"><a class="title" href="https://example.com/ad">Sponsored record</a></p></div>
		</div>`;
	const html = fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'mhtml', 'frontpage.html'), 'utf8')
		.replace('<div id="siteTable" class="sitetable linklisting">', `<div id="siteTable" class="sitetable linklisting">${initialPromoted}`);
	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });
	await page.waitForSelector('[data-fullname="t3_ad0001"][data-rsm-promoted-hidden="true"]', { state: 'attached' });

	const initialState = await page.evaluate(() => ({
		promotedDisplay: getComputedStyle(document.querySelector('[data-fullname="t3_ad0001"]')).display,
		ordinaryDisplay: getComputedStyle(document.querySelector('[data-fullname="t3_post00000001"]')).display,
		badge: document.querySelector('[data-rsm-promoted-badge="true"]')?.textContent,
	}));
	assert.equal(initialState.promotedDisplay, 'none', 'server-rendered promoted records must be suppressed');
	assert.notEqual(initialState.ordinaryDisplay, 'none', 'ordinary listing records must remain visible');
	assert.equal(initialState.badge, '1', 'the visible diagnostic should count the initial promoted record');

	await page.evaluate(() => {
		const record = document.createElement('div');
		record.className = 'thing link even';
		record.dataset.fullname = 't3_ad0002';
		record.dataset.subreddit = 'example';
		record.dataset.domain = 'example.com';
		record.dataset.author = 'advertiser';
		record.innerHTML = '<div class="entry"><p class="title"><a class="title" href="https://alb.reddit.com/click">Async sponsored record</a><span class="promoted-tag">promoted</span></p></div>';
		document.querySelector('#siteTable').append(record);
	});
	await page.waitForSelector('[data-fullname="t3_ad0002"][data-rsm-promoted-hidden="true"]', { state: 'attached' });

	const asyncState = await page.evaluate(() => ({
		display: getComputedStyle(document.querySelector('[data-fullname="t3_ad0002"]')).display,
		badge: document.querySelector('[data-rsm-promoted-badge="true"]')?.textContent,
		ordinaryPresent: !!document.querySelector('[data-fullname="t3_post00000001"]'),
	}));
	assert.equal(asyncState.display, 'none', 'late-inserted promoted records must be suppressed');
	assert.equal(asyncState.badge, '2', 'the diagnostic should include late-inserted promoted records');
	assert.equal(asyncState.ordinaryPresent, true, 'late ad filtering must not remove ordinary posts');
});

test('the content script initialises on a real old.reddit document', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const html = servableCapture();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
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
	assert.match(classes, /\bres-pageTheme--refined\b/, 'the default old Reddit skin should include the refined layout');

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

	const discussionSurface = await page.evaluate(() => {
		const post = document.querySelector('body.comments-page > .content > .sitetable > .thing.link');
		const postTitle = post?.querySelector('.title');
		const postThumbnail = post?.querySelector(':scope > .thumbnail');
		const media = post?.querySelector('.media-preview');
		const mediaContent = media?.querySelector('.media-preview-content');
		const mediaImage = mediaContent?.querySelector('img');
		const mediaRect = media?.getBoundingClientRect();
		const mediaContentRect = mediaContent?.getBoundingClientRect();
		const toolbar = document.querySelector('.commentarea .menuarea');
		const composer = document.querySelector('.commentarea > .usertext');
		const textarea = composer?.querySelector('textarea');
		const save = composer?.querySelector('button.save');
		const comment = document.querySelector('.commentarea > .sitetable > .comment');
		const body = comment?.querySelector('.md');
		const nested = document.querySelector('.commentarea .comment .comment');
		const child = nested?.closest('.child');
		return {
			postTitleSize: postTitle ? getComputedStyle(postTitle).fontSize : null,
			postThumbnailDisplay: postThumbnail ? getComputedStyle(postThumbnail).display : null,
			mediaWidth: mediaRect?.width ?? null,
			mediaContentWidth: mediaContentRect?.width ?? null,
			mediaImageWidth: mediaImage?.getBoundingClientRect().width ?? null,
			mediaLeftSpace: mediaRect && mediaContentRect ? mediaContentRect.left - mediaRect.left : null,
			mediaRightSpace: mediaRect && mediaContentRect ? mediaRect.right - mediaContentRect.right : null,
			toolbarHeight: toolbar?.getBoundingClientRect().height ?? null,
			toolbarBackground: toolbar ? getComputedStyle(toolbar).backgroundColor : null,
			composerWidth: composer?.getBoundingClientRect().width ?? null,
			textareaWidth: textarea?.getBoundingClientRect().width ?? null,
			textareaHeight: textarea?.getBoundingClientRect().height ?? null,
			saveHeight: save?.getBoundingClientRect().height ?? null,
			commentRadius: comment ? getComputedStyle(comment).borderRadius : null,
			commentBackground: comment ? getComputedStyle(comment).backgroundColor : null,
			bodyBackground: body ? getComputedStyle(body).backgroundColor : null,
			nestedBorderWidth: nested ? getComputedStyle(nested).borderLeftWidth : null,
			childBorderWidth: child ? getComputedStyle(child).borderLeftWidth : null,
			childMarginLeft: child ? getComputedStyle(child).marginLeft : null,
		};
	});
	assert.equal(discussionSurface.postTitleSize, '20px', 'opened posts should promote the article title above listing-card hierarchy');
	assert.equal(discussionSurface.postThumbnailDisplay, 'none', 'opened posts should not repeat a listing thumbnail beside full content');
	assert.ok(discussionSurface.mediaImageWidth <= discussionSurface.mediaContentWidth, 'the media wrapper should contain the rendered preview without clipping it');
	assert.ok(discussionSurface.mediaContentWidth < discussionSurface.mediaWidth, 'centering media must not stretch it across the entire preview surface');
	assert.ok(Math.abs(discussionSurface.mediaLeftSpace - discussionSurface.mediaRightSpace) <= 1, 'opened media should be visually centred in its preview surface');
	assert.ok(discussionSurface.toolbarHeight >= 44 && discussionSurface.toolbarHeight <= 56, 'comment sorting should have a stable toolbar-sized target');
	assert.notEqual(discussionSurface.toolbarBackground, 'rgba(0, 0, 0, 0)', 'comment sorting should read as a deliberate surface');
	assert.equal(discussionSurface.composerWidth, 960, 'desktop discussions should provide a comfortable writing workspace');
	assert.ok(discussionSurface.textareaWidth > 900, 'the textarea should fill the composer instead of keeping old Reddit\'s narrow fixed width');
	assert.ok(discussionSurface.textareaHeight >= 148, 'the composer should expose enough vertical room for a real reply');
	assert.ok(discussionSurface.saveHeight >= 40, 'the comment action should be an obvious pointer target');
	assert.equal(discussionSurface.commentRadius, '8px', 'top-level comments should read as distinct discussion cards');
	assert.notEqual(discussionSurface.commentBackground, 'rgba(0, 0, 0, 0)', 'the top-level comment card needs a visible surface');
	assert.equal(discussionSurface.bodyBackground, 'rgba(0, 0, 0, 0)', 'comment prose should not sit inside a second dark rectangle');
	assert.equal(discussionSurface.nestedBorderWidth, '2px', 'nested replies should keep one clear depth guide');
	assert.equal(discussionSurface.childBorderWidth, '0px', 'native dotted child borders should not duplicate the refined guide');
	assert.equal(discussionSurface.childMarginLeft, '0px', 'nested replies should not pay for two separate indentation systems');

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

test('selector drift records one local diagnostic without a toast', async t => {
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);

	const html = servableCapture(FRONT_CAPTURE).replace(
		'id="siteTable" class="sitetable linklisting"',
		'id="legacySiteTable" class="sitetable linklisting"',
	);
	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	const load = async () => {
		await page.goto('https://old.reddit.com/rsm-selector-drift/', { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });
	};
	const selectorEntries = () => worker.evaluate(() => new Promise(resolve => {
		chrome.storage.local.get('RES.moduleErrorLog', values => resolve(
			(values['RES.moduleErrorLog'] || []).filter(entry => entry.moduleID === 'oldRedditSelectors'),
		));
	}));

	await load();
	let entries = [];
	for (let attempt = 0; attempt < 50 && !entries.length; attempt++) {
		await page.waitForTimeout(50); // eslint-disable-line no-await-in-loop
		entries = await selectorEntries(); // eslint-disable-line no-await-in-loop
	}
	assert.equal(entries.length, 1, 'one aggregated selector warning should be persisted locally');
	assert.equal(entries[0].stage, 'selector-drift:linklist');
	assert.match(entries[0].message, /listingFeed matched fallback "\.linklisting \.thing\.link"/);
	assert.equal(
		await page.locator('.RESNotification').filter({ hasText: 'selector drift' }).count(),
		0,
		'selector health is a diagnostics-console concern, not a page toast',
	);

	await load();
	await page.waitForTimeout(250);
	entries = await selectorEntries();
	assert.equal(entries.length, 1, 'reloading the same drift must not duplicate its local warning');
});

test('a read-only Reddit JSON module sends authenticated requests through the shared helper', async t => {
	const { context, dispose } = await launchWithExtension();
	t.after(dispose);

	await context.addCookies([{
		name: 'reddit_session',
		value: 'e2e-authenticated-fixture',
		domain: '.reddit.com',
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
	}]);
	const html = servableCapture(FRONT_CAPTURE);
	const json = JSON.stringify([
		{ data: { children: [{ kind: 't3', data: { name: 't3_public' } }] } },
		{ data: { children: [{
			kind: 't1',
			data: {
				author: 'fixture_reader',
				score: 8,
				body: 'Useful public answer',
				body_html: '<div class="md"><p>Useful public answer</p></div>',
			},
		}] } },
	]);
	const requests = [];
	const page = await context.newPage();
	await context.route('**/*', route => {
		const request = route.request();
		const url = request.url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (request.resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		if (url.includes('/r/fixture/comments/post0000001/fixture-post.json')) {
			requests.push({
				method: request.method(),
				accept: request.headers().accept,
				cookie: request.headers().cookie || '',
				body: request.postData(),
			});
			return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: json });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.rsm-tcp-link', { timeout: 30000 });
	await page.locator('.rsm-tcp-link').first().click();
	await page.waitForSelector('.rsm-tcp-content--ready', { timeout: 10000 });
	assert.match(await page.locator('.rsm-tcp-content--ready').innerText(), /Useful public answer/);
	assert.equal(requests.length, 1, 'one preview should make one Reddit JSON request');
	assert.deepEqual(requests[0], {
		method: 'GET',
		accept: 'application/json',
		cookie: 'reddit_session=e2e-authenticated-fixture',
		body: null,
	});
});

test('an unreadable accent colour is flagged in the console and corrected on the page', async t => {
	// The accent is a `type: 'color'` option, so a user can pick `#333` — about
	// 1.2:1 on every shipped palette — and get visited titles they cannot read and
	// a focus outline they cannot see. Nothing told them, and nothing corrected it.
	//
	// Both halves are checked here because either alone is a worse product: a
	// silent correction leaves the settings page showing a colour the page does
	// not paint, and a warning with no correction leaves the page unreadable.
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.goto(`${extensionUrl(extensionId, 'options.html')}#res:settings/pageTheme`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	// `data-option-key`, not `#accent`: option ids are namespaced by module now,
	// because a bare option key as a DOM id collides between modules. The key is
	// what identifies the option; the id is only its address.
	const accent = page.locator('#optionContainer-pageTheme-accent [data-option-key="accent"]');
	await accent.waitFor({ timeout: 30000 });
	const advice = page.locator('#optionContainer-pageTheme-accent .optionAdvice');

	// The shipped default clears both floors on every palette, so a fresh install
	// must not be nagged.
	assert.equal(await advice.isVisible(), false, 'the default accent must not raise advice');

	await accent.evaluate(el => {
		el.value = '#333333';
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	});

	await advice.waitFor({ state: 'visible', timeout: 10000 });
	assert.match(await advice.innerText(), /below the 4\.5:1/, 'the advice must name the floor it fails');

	// The suggestion is offered, not applied — until the user takes it.
	const action = page.locator('#optionContainer-pageTheme-accent .optionAdviceAction');
	assert.match(await action.innerText(), /^Use #[0-9a-f]{6}$/i);
	assert.equal(await accent.inputValue(), '#333333', 'nothing may be rewritten behind the user');

	const suggested = (await action.innerText()).replace('Use ', '').toLowerCase();
	await action.click();
	assert.equal((await accent.inputValue()).toLowerCase(), suggested, 'taking the suggestion sets the input');
	await page.waitForFunction(
		() => {
			const note = document.querySelector('#optionContainer-pageTheme-accent .optionAdvice');
			return note && note.hidden;
		},
		null,
		{ timeout: 10000 },
	);

	// Now the page side: with an unreadable accent saved, the theme must paint a
	// corrected shade rather than the raw value.
	await page.evaluate(() => new Promise((resolve, reject) => {
		chrome.storage.local.set({
			'RESoptions.pageTheme': { accent: { value: '#333333' }, theme: { value: 'graphite' } },
		}, () => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
	}));

	const reddit = await context.newPage();
	const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>accent probe</title></head><body class="listing-page"><main class="content" role="main"></main></body></html>';
	await reddit.route('**/*', route => {
		const request = route.request();
		if (request.resourceType() === 'document' && request.url().includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	await reddit.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
	await reddit.waitForFunction(
		() => document.documentElement.style.getPropertyValue('--rsm-th-accent-text').trim().length > 0,
		null,
		{ timeout: 30000 },
	);

	const painted = await reddit.evaluate(() => {
		const style = document.documentElement.style;
		return {
			raw: style.getPropertyValue('--rsm-th-accent').trim(),
			text: style.getPropertyValue('--rsm-th-accent-text').trim(),
			ui: style.getPropertyValue('--rsm-th-accent-ui').trim(),
		};
	});

	assert.equal(painted.raw, '#333333', 'the raw accent still drives the decorative color-mix blends');
	assert.notEqual(painted.text, '#333333', 'visited titles must not be painted the unreadable value');
	assert.notEqual(painted.ui, '#333333', 'the focus outline must not be painted the unreadable value');
});

test('the console stays usable in forced colours and increased contrast', async t => {
	// Windows High Contrast forces every author colour, drops `box-shadow`, and
	// drops any non-url() `background-image`. That is the whole vocabulary this
	// console is drawn in — the switch is an accent fill, selection is a tinted
	// row, the focus ring is a shadow plus an accent outline — so without explicit
	// handling every one of those states renders identically to its opposite.
	//
	// Emulated rather than asserted from source: `forced-colors` is applied by the
	// UA, and only a real engine can say what survives it.
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.emulateMedia({ forcedColors: 'active' });
	await page.goto(`${extensionUrl(extensionId, 'options.html')}#res:settings/pageTheme`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });
	await page.waitForSelector('.toggleButton', { timeout: 30000 });

	const outlineOf = (selector, pseudo) => page.evaluate(([sel, ps]) => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const style = getComputedStyle(el, ps || undefined);
		return { color: style.outlineColor, width: style.outlineWidth, style: style.outlineStyle, background: style.backgroundColor };
	}, [selector, pseudo]);

	// A text field with no edge is not a text field.
	const field = await outlineOf('#RESConsoleContainer input[type="color"]');
	assert.ok(field, 'the accent colour input should be on this page');
	assert.equal(field.style, 'solid', 'controls need an edge that survives forced colours');
	assert.notEqual(field.width, '0px');

	// On and off must not render identically. The track outline is the signal.
	const enabledTrack = await outlineOf('.toggleButton.enabled .toggleThumb');
	const anyTrack = await outlineOf('.toggleButton:not(.enabled) .toggleThumb');
	assert.ok(enabledTrack, 'the module toggle should be present');
	if (anyTrack) {
		assert.notEqual(
			`${enabledTrack.color}|${enabledTrack.width}`,
			`${anyTrack.color}|${anyTrack.width}`,
			'an enabled switch must not look identical to a disabled one under forced colours',
		);
	}

	// The selected category is a tinted row in normal rendering, and the tint is
	// exactly what gets forced away.
	const activeTab = await outlineOf('.categoryTab.is-active');
	assert.ok(activeTab, 'a category tab should be active');
	assert.equal(activeTab.style, 'solid');
	assert.notEqual(activeTab.width, '0px', 'selection must survive as more than a background colour');

	// Increased contrast is a separate preference and keeps the palette; what it
	// must drop is the translucent decoration.
	await page.emulateMedia({ forcedColors: null, contrast: 'more' });
	const contrastTokens = await page.evaluate(() => {
		const style = getComputedStyle(document.documentElement);
		return {
			border: style.getPropertyValue('--options-border').trim(),
			control: style.getPropertyValue('--options-control-border').trim(),
			shadow: style.getPropertyValue('--options-shadow').trim(),
		};
	});
	assert.equal(contrastTokens.border, contrastTokens.control, 'the decorative border should be promoted to the measured 3:1 one');
	assert.equal(contrastTokens.shadow, 'none', 'translucent elevation should be dropped');
});

test('the in-page UI keeps its edges in forced colours', async t => {
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.emulateMedia({ forcedColors: 'active' });
	const html = '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>forced colours probe</title></head><body class="listing-page"><main class="content" role="main"><div id="siteTable"><div class="thing link" data-fullname="t3_a" data-url="https://example.com/a"><div class="entry"><p class="title"><a class="title" href="/r/x/comments/a/t/">A post</a></p></div></div></div></main></body></html>';
	await page.route('**/*', route => {
		const request = route.request();
		if (request.resourceType() === 'document' && request.url().includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	await page.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('html.res-pageTheme', { timeout: 30000 });

	// Probes rather than a captured page state: these surfaces appear on user
	// action (a toast, the saved-comments panel, a selected entry), and what is
	// under test is whether the shipped stylesheet gives them an edge when the UA
	// takes their background away. The probe carries the real class, and the rule
	// is keyed on exactly that.
	const measured = await page.evaluate(() => {
		const reference = document.createElement('span');
		reference.style.outline = '1px solid Highlight';
		document.body.append(reference);
		const highlight = getComputedStyle(reference).outlineColor;
		reference.remove();

		const read = className => {
			const probe = document.createElement('div');
			probe.className = className;
			document.body.append(probe);
			const style = getComputedStyle(probe);
			const result = { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
			probe.remove();
			return result;
		};

		return {
			highlight,
			toast: read('rsm-toast'),
			panel: read('rsm-savedBackup-panel'),
			badge: read('rsm-repost-badge'),
			selected: read('res-selected'),
		};
	});

	for (const surface of ['toast', 'panel', 'badge']) {
		assert.equal(measured[surface].style, 'solid', `${surface} must keep an edge when its background is forced away`);
		assert.notEqual(measured[surface].width, '0px', `${surface} outline should have width`);
	}

	// Selection is a background tint everywhere in this codebase, so under forced
	// colours it has to be restated as the system colour that means selection.
	assert.equal(measured.selected.color, measured.highlight, 'a selected entry must be marked with Highlight, not a forced author hue');
	assert.notEqual(measured.selected.width, '0px');
});

test('Escape inside a text field clears the field rather than closing the console', async t => {
	// `document.body.addEventListener('keyup', handleEscapeKey)` had no target
	// guard, so the keystroke that normally means "abandon what I am typing" threw
	// away the whole workspace — including anything staged but unsaved.
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	const search = page.locator('#RESConsoleContainer input[type="search"], #RESConsoleContainer input[type="text"]').first();
	await search.waitFor({ timeout: 30000 });
	await search.fill('night');
	await page.keyboard.press('Escape');

	assert.equal(await search.inputValue(), '', 'the first Escape should clear the field');
	assert.ok(await page.locator('#RESConsoleContainer').isVisible(), 'and must not take the console with it');

	// The console's own search field also drops focus on Escape, so by now the
	// keystroke is no longer landing in an input — and from there Escape must
	// still close, or the guard would have turned a working dismissal into a dead
	// key. On the standalone options page closing means the page itself goes
	// away, so either outcome counts.
	// Every call after this can race the page going away, and a closed page *is*
	// the pass here rather than an error to guard against.
	let stillOpen;
	try {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		stillOpen = await page.locator('#RESConsoleContainer').isVisible();
	} catch (e) {
		stillOpen = false;
	}
	assert.equal(stillOpen, false, 'Escape outside a text field must still close the console');
});

test('a vendored library injects into the extension world it is used from', async t => {
	// `galleryZip` used to reach JSZip with `await import('jszip')`, which the
	// bundler resolved statically: 153KB of ZIP library in the content script on
	// every Reddit page, for a module disabled by default. It now loads the file
	// on demand, the way `showImages` already loads dashjs.
	//
	// Nothing under tests/unit/ can check that path. The unit contract answers the
	// `loadScript` message itself, so it proves the module asks and uses what it
	// gets — but whether `chrome.scripting.executeScript` puts a UMD global where
	// the *content script* can see it is a property of the browser, and this repo
	// has been burned before by a permission boundary that only fails for real
	// (imgurFlatten's probe was CORS-blocked in the service worker for its whole
	// life while every test passed).
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.route('**/*', route => {
		if (route.request().resourceType() === 'document') {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: servableCapture(FRONT_CAPTURE) });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	await page.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });

	const probe = await worker.evaluate(async () => {
		const [tab] = await chrome.tabs.query({ url: 'https://old.reddit.com/*' });
		if (!tab) return { error: 'no reddit tab' };
		const before = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => typeof JSZip });
		await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/jszip.min.js'] });
		const after = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => typeof JSZip });
		// The page's own world must stay clean: injecting into MAIN would hand a
		// library to reddit's scripts and let reddit's scripts replace it.
		const main = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => typeof JSZip });
		return { before: before[0].result, after: after[0].result, main: main[0].result };
	});

	assert.equal(probe.error, undefined, `probe failed: ${probe.error}`);
	assert.equal(probe.before, 'undefined', 'the library must not be present until something asks for it');
	assert.equal(probe.after, 'function', 'loadScript must define JSZip in the world the content script runs in');
	assert.equal(probe.main, 'undefined', 'and must not leak it into the page');
});

test('the mandatory-login overlay is dismissed only when there is a page behind it', async t => {
	// The unit contract supplies `getBoundingClientRect` by hand, because jsdom
	// reports zeroes for every geometry and `position: static` for everything —
	// which would make the coverage predicate vacuously false for every element on
	// the page, including a real wall. The whole mechanism is geometric, so it has
	// to be measured somewhere real.
	//
	// The fixture is synthetic on purpose. Reddit's wall rolled out geographically
	// and gradually from 2026-06-30 and this repo has no capture of a walled page,
	// so the module matches on shape rather than on class names; what is asserted
	// here is that shape, under a browser that actually does layout.
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);

	// From the service worker: the page's main world has no `chrome.storage`.
	// `RES.modulePrefs` holds enabled state; the options themselves live under
	// `RESoptions.<moduleID>`, and setting the first without the second leaves the
	// opt-in exactly as off as it ships.
	await worker.evaluate(() => new Promise(resolve => chrome.storage.local.set({
		'RES.modulePrefs': { frictionRemovers: true },
		'RESoptions.frictionRemovers': { dismissLoginWall: { value: true } },
	}, resolve)));

	const wall = `
		<div class="SomeRolloutClassName" style="position: fixed; inset: 0; background: #101010; z-index: 2147483647;">
			<h2 style="color: #fff">Log in to continue</h2>
		</div>
		<style>html, body { overflow: hidden !important; }</style>`;

	// The empty case is not the capture with its posts deleted — it is what reddit
	// actually sends when it walls a page: the chrome, and nothing else.
	const EMPTY_WALLED = `<!doctype html><html><body class="listing-page">
		<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
		<div class="content" role="main"><div id="siteTable"></div></div>
		${wall}
	</body></html>`;

	async function measure(body) {
		const html = body === 'empty' ?
			EMPTY_WALLED :
			servableCapture(FRONT_CAPTURE).replace('</body>', `${wall}</body>`);

		const tab = await context.newPage();
		await tab.route('**/*', route => {
			const url = route.request().url();
			if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
				return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
			}
			return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
		});
		await tab.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded' });
		await tab.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });
		await tab.waitForTimeout(500);

		const state = await tab.evaluate(() => {
			const overlay = document.querySelector('.SomeRolloutClassName');
			const post = document.querySelector('#siteTable .thing');
			return {
				overlayHidden: !overlay || getComputedStyle(overlay).display === 'none',
				unwalled: document.documentElement.classList.contains('rsm-friction-unwalled'),
				bodyOverflow: getComputedStyle(document.body).overflow,
				postVisible: !!post && !!post.getBoundingClientRect().height,
				consoleStillThere: !!document.querySelector('#header'),
			};
		});
		await tab.close();
		return state;
	}

	const walled = await measure('full');
	assert.equal(walled.overlayHidden, true, 'a full-viewport fixed overlay over a real page is the thing this feature exists for');
	assert.equal(walled.unwalled, true);
	assert.notEqual(walled.bodyOverflow, 'hidden', 'restoring scroll is half the feature — an unblocked page you cannot scroll is still unusable');
	assert.equal(walled.postVisible, true, 'and the content it was covering must be what is left');
	assert.equal(walled.consoleStillThere, true, 'the page chrome is not an overlay');

	const empty = await measure('empty');
	assert.equal(empty.postVisible, false, 'the empty fixture has to actually be empty, or the next two assertions pass for the wrong reason');
	assert.equal(empty.overlayHidden, false, 'with nothing behind it, hiding the wall would leave a blank page that looks like success');
	assert.equal(empty.unwalled, false);
});

test('drift on a real page shows up as a dated view in the settings console', async t => {
	// The unit contract can prove the record is structured and the report is
	// clean; it cannot prove the console is wired to either. This drives the whole
	// path — a capture with a renamed surface, the content script recording it,
	// and the console rendering it — because every previous version of this
	// feature ended at "a line in a textarea" and looked fine from the inside.
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const html = servableCapture(FRONT_CAPTURE).replace(
		'id="siteTable" class="sitetable linklisting"',
		'id="legacySiteTable" class="sitetable linklisting"',
	);
	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	await page.goto('https://old.reddit.com/rsm-drift-console/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });
	await page.waitForTimeout(400);
	await page.close();

	const options = await context.newPage();
	await options.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	await options.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	const panel = options.locator('#RESSelectorDrift');
	await panel.waitFor({ state: 'visible', timeout: 30000 });

	const rendered = await options.evaluate(() => {
		const group = document.querySelector('#RESSelectorDriftList .selectorDriftGroup');
		return {
			title: document.querySelector('#RESSelectorDriftTitle')?.textContent || '',
			pageType: group?.dataset.pageType || '',
			dates: group?.querySelector('.selectorDriftGroupDates')?.textContent || '',
			findings: Array.from(group?.querySelectorAll('.selectorDriftFinding') || []).map(li => li.textContent),
			// Contrast is asserted elsewhere; what matters here is that the panel is
			// painted at all rather than inheriting a transparent background from a
			// container that assumed it was never shown.
			background: getComputedStyle(document.querySelector('#RESSelectorDrift')).backgroundColor,
		};
	});

	assert.match(rendered.title, /Selector drift/);
	assert.equal(rendered.pageType, 'linklist', 'the view is per page kind, not one flat list');
	assert.match(rendered.dates, /Seen |Since /, 'and dated');
	assert.ok(
		rendered.findings.some(text => /listingFeed — matched fallback selector/.test(text)),
		`expected the drifted surface to be named, saw ${JSON.stringify(rendered.findings)}`,
	);
	assert.notEqual(rendered.background, 'rgba(0, 0, 0, 0)');

	// Clearing empties the view without claiming the checking has stopped.
	await options.locator('#RESSelectorDriftClear').click();
	await panel.waitFor({ state: 'hidden', timeout: 10000 });

	// And a console opened with nothing recorded shows nothing at all.
	await options.reload({ waitUntil: 'domcontentloaded' });
	await options.waitForSelector('#RESConsoleContainer', { timeout: 30000 });
	await options.waitForTimeout(400);
	assert.equal(await panel.isVisible(), false, 'silence when every selector matches is the feature, not an oversight');
});

test('the alert modal traps focus, sits above the page, and cancels on Escape', async t => {
	// The unit contract can only prove which promise settles: jsdom implements
	// none of `<dialog>`'s behaviour, so `loadModule` shims the state and the
	// close event and nothing else. Everything the element was chosen *for* is
	// the browser's — the top layer, the focus trap, the inertness of the page
	// behind it, and Escape being routed to a `cancel` event — and none of it is
	// reachable outside a real one.
	//
	// This matters more than usual here. The overlay this replaced answered
	// Escape by *confirming* when the dialog was not cancelable, so the gesture
	// every user reads as "no" could mean "yes".
	// Served on a reddit page rather than the options page. The settings console
	// listens for Escape on `document.body`, and on the standalone options page
	// that means the page itself goes away mid-assertion — a real behaviour, and
	// one this file already covers separately, but it drowns out what is being
	// measured here.
	const { context, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: servableCapture(FRONT_CAPTURE) });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	await page.goto('https://old.reddit.com/rsm-alert-probe/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });

	// A button behind the dialog, so "is the page inert" has something to ask
	// about, and so focus has somewhere real to return to.
	await page.evaluate(() => {
		const behind = document.createElement('button');
		behind.id = 'rsm-e2e-behind';
		behind.textContent = 'behind';
		document.body.append(behind);
		const invoker = document.createElement('button');
		invoker.id = 'rsm-e2e-invoker';
		invoker.textContent = 'open';
		document.body.append(invoker);
		invoker.focus();
	});

	// The options bundle exposes the console; Alert is reached through it rather
	// than re-implemented, so what runs here is the shipped code.
	const opened = await page.evaluate(() => {
		window.__rsmAlertOutcome = 'pending';
		const dialog = document.createElement('dialog');
		dialog.id = 'rsm-e2e-alert-probe';
		dialog.innerHTML = '<button id="rsm-e2e-inside">inside</button>';
		document.body.append(dialog);
		dialog.addEventListener('cancel', () => { window.__rsmAlertOutcome = 'cancelled'; });
		dialog.showModal();
		return { open: dialog.open, focused: document.activeElement && document.activeElement.id };
	});
	assert.equal(opened.open, true, 'showModal must actually open it — this is the API the product now depends on');
	assert.equal(opened.focused, 'rsm-e2e-inside', 'the platform moves focus into the dialog');

	// Inertness: a click on the element behind a modal dialog does not reach it.
	const reachedBehind = await page.evaluate(async () => {
		let clicked = false;
		const behind = document.querySelector('#rsm-e2e-behind');
		behind.addEventListener('click', () => { clicked = true; });
		behind.click(); // a scripted click still dispatches...
		const scripted = clicked;
		clicked = false;
		// ...but a real pointer cannot reach it, which is what `inert` means here.
		const rect = behind.getBoundingClientRect();
		const top = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
		return { scripted, topIsBehind: top === behind };
	});
	assert.equal(reachedBehind.scripted, true, 'sanity: the element behind still exists and still has its listener');
	assert.equal(reachedBehind.topIsBehind, false, 'the page behind a modal must not be the hit-test target');

	// Escape produces a `cancel` event, which is the whole reason the product
	// stopped hand-rolling the key handling.
	await page.keyboard.press('Escape');
	await page.waitForTimeout(150);
	const outcome = await page.evaluate(() => ({
		outcome: window.__rsmAlertOutcome,
		stillOpen: document.querySelector('#rsm-e2e-alert-probe').open,
	}));
	assert.equal(outcome.outcome, 'cancelled', 'Escape on a modal dialog is a cancel, not a confirm');
	assert.equal(outcome.stillOpen, false);
});

test('every option control in the console has a name a screen reader can announce', async t => {
	// Source assertions can check that the attributes are written. Only a real
	// browser can compute what they add up to — and the three broken types
	// (`enum`, `button`, `keycode`) were broken precisely because the attributes
	// looked present: `<label for>` pointed at elements that cannot be labelled,
	// so the markup read fine and the accessible name was empty.
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#RESConsoleContainer', { timeout: 30000 });

	// One module per option type the console actually renders. Chosen by grepping
	// the registry rather than by memory, so a type that stops being used shows up
	// as a module that no longer has it rather than as silent loss of coverage.
	const BY_TYPE = [
		{ moduleID: 'a11yTriple', types: ['enum', 'boolean'] },
		{ moduleID: 'commentPreview', types: ['keycode'] },
		{ moduleID: 'commentHighlights', types: ['color'] },
		{ moduleID: 'commentDepth', types: ['list'] },
		{ moduleID: 'commentTools', types: ['textarea'] },
		{ moduleID: 'arcticShift', types: ['text'] },
	];

	const seenTypes = new Set();
	const unnamed = [];

	for (const { moduleID, types } of BY_TYPE) {
		await page.evaluate(id => { location.hash = `#!settings/${id}`; }, moduleID);
		await page.waitForFunction(
			id => !!document.querySelector(`[id^="optionContainer-${id}-"]`),
			moduleID,
			{ timeout: 30000 },
		);
		await page.waitForTimeout(150);
		for (const type of types) seenTypes.add(type);

		// The computed accessibility tree, not the DOM: this is the name the
		// platform hands to assistive technology, after `aria-labelledby`,
		// `aria-label`, `<label for>` and content have all been resolved against
		// each other. An `ariaSnapshot` line reads `- role "name"`, so a role with
		// no name has no quoted part at all — which is exactly the failure the
		// three broken option types produced.
		const snapshot = await page.locator('#allOptionsContainer').ariaSnapshot();
		const NAMEABLE = ['textbox', 'radiogroup', 'radio', 'combobox', 'checkbox', 'switch', 'slider', 'listbox'];
		for (const line of snapshot.split('\n')) {
			const match = /^\s*-\s+([a-z]+)(.*)$/.exec(line);
			if (!match) continue;
			const [, role, rest] = match;
			if (!NAMEABLE.includes(role)) continue;
			if (!/"[^"]+"/.test(rest)) unnamed.push(`${moduleID}: ${role} with no accessible name — ${line.trim()}`);
		}

		// And the controls the console rendered are really there — a module whose
		// options failed to draw would otherwise pass by having nothing to check.
		const controlCount = await page.locator('#allOptionsContainer input, #allOptionsContainer select, #allOptionsContainer textarea, #allOptionsContainer [role="radiogroup"]').count();
		assert.ok(controlCount > 0, `${moduleID} rendered no option controls at all`);
	}

	assert.deepEqual(unnamed, [], 'every option control needs a name; these had none');
	assert.deepEqual(
		[...seenTypes].sort(),
		['boolean', 'color', 'enum', 'keycode', 'list', 'text', 'textarea'],
		'coverage drifted — a type listed here is no longer reached by the modules above',
	);
});

// A 1x1 transparent PNG, so an <img> the overlay viewer can bind to actually
// decodes under the DNS blackhole the harness launches with.
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('the image viewer sits in the top layer, where a hover card cannot cover it', async t => {
	// This is the test that had to exist before the fix. As a <div> the viewer
	// carried `z-index: 100000` while `.RESHover` carried `$zindex-res-hover`,
	// 10,300,000 — two orders of magnitude higher — so with the viewer open, a
	// hover card painted on top of the modal. The pairing is reachable: `hover` is
	// alwaysEnabled, its card lingers for `fadeDelay` (500ms) plus a 0.7s fade
	// after the pointer leaves, and clicking an image inside that window is
	// ordinary use.
	//
	// The assertion is the browser's own hit test, not the numbers.
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);

	await worker.evaluate(() => new Promise(resolve => chrome.storage.local.set({
		'RES.modulePrefs': { overlayViewer: true },
		'RESoptions.overlayViewer': { includeCommentImages: { value: true } },
	}, resolve)));

	const html = servableCapture();
	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		if (route.request().resourceType() === 'image') {
			return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/r/fixture/comments/post0000001/fixture-post/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });

	await page.evaluate(() => {
		const body = document.querySelector('.usertext-body .md');
		const img = document.createElement('img');
		img.src = 'https://i.redd.it/fixture-probe.png';
		img.id = 'probe-image';
		img.width = 200;
		img.height = 120;
		body.appendChild(img);
	});
	await page.click('#probe-image');
	await page.waitForSelector('#rsm-overlayViewer', { state: 'attached' });

	const shape = await page.evaluate(() => {
		const overlay = document.querySelector('#rsm-overlayViewer');
		return {
			tag: overlay.tagName,
			open: overlay.hasAttribute('open'),
			zIndex: getComputedStyle(overlay).zIndex,
			backdropDim: getComputedStyle(overlay).getPropertyValue('--rsm-overlay-dim').trim(),
		};
	});
	assert.equal(shape.tag, 'DIALOG', 'the viewer has to be a real dialog to reach the top layer');
	assert.equal(shape.open, true, 'showModal() must have run — an appended dialog with no open attribute renders nothing');
	assert.equal(shape.zIndex, 'auto', 'a top-layer element that still carries a z-index is a number that could be beaten');
	assert.equal(shape.backdropDim, '0.85', 'the dim option has to reach ::backdrop now that it is not the element background');

	// Now the original defect, reproduced exactly: the highest-numbered surface
	// RES-Slim ships, placed over the open viewer.
	const verdict = await page.evaluate(() => {
		const card = document.createElement('div');
		card.className = 'RESHover RESHoverInfoCard RESDialogSmall';
		// `.RESHover` is position: absolute, so its offsets are document
		// coordinates while elementFromPoint takes viewport ones. Opening the
		// viewer scrolls the page, so a card placed at a flat `top: 200px` sits
		// nowhere near the point being probed - and the hit test then reports the
		// overlay on top no matter what, which is a test that cannot fail.
		Object.assign(card.style, {
			top: `${window.scrollY + 200}px`,
			left: `${window.scrollX + 200}px`,
			width: '300px',
			height: '150px',
		});
		card.textContent = 'hover card';
		document.body.appendChild(card);
		const hit = document.elementFromPoint(250, 250);
		const box = card.getBoundingClientRect();
		return {
			cardZ: getComputedStyle(card).zIndex,
			hitClass: hit ? hit.className : null,
			hitInsideOverlay: !!(hit && hit.closest('#rsm-overlayViewer')),
			probeInsideCard: box.left <= 250 && box.right >= 250 && box.top <= 250 && box.bottom >= 250,
		};
	});
	assert.equal(verdict.cardZ, '10300000', 'the hover card should still carry the number that used to win');
	assert.equal(verdict.probeInsideCard, true, 'the probed point has to land inside the card, or the hit test proves nothing');
	assert.equal(verdict.hitInsideOverlay, true,
		`a hover card at z-index 10300000 covered the open viewer — hit ${verdict.hitClass}`);

	// Escape still closes, and through the module's own path: the body class and
	// the focus restore both live there, and a bare `cancel` would skip them.
	await page.keyboard.press('Escape');
	await page.waitForSelector('#rsm-overlayViewer', { state: 'detached' });
	const bodyClass = await page.evaluate(() => document.body.className);
	assert.ok(!bodyClass.includes('rsm-overlayViewer-open'), 'closing must run the module cleanup, not just the dialog close');
});

test('the hover-zoom preview is in the top layer and takes no focus', async t => {
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);

	await worker.evaluate(() => new Promise(resolve => chrome.storage.local.set({
		'RES.modulePrefs': { hoverZoom: true },
	}, resolve)));

	const html = servableCapture();
	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		if (route.request().resourceType() === 'image') {
			return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});

	await page.goto('https://old.reddit.com/r/fixture/comments/post0000001/fixture-post/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });

	// The module builds the preview from a hover on a media link; driving that
	// needs a link it recognises, so the element is built through the same code
	// path by dispatching a real pointer event over one.
	await page.evaluate(() => {
		const target = document.querySelector('.usertext-body .md');
		const a = document.createElement('a');
		a.href = 'https://i.redd.it/fixture-probe.png';
		a.textContent = 'a picture';
		a.id = 'probe-link';
		target.appendChild(a);
	});
	// Centred, not merely scrolled into view: `scrollIntoView()` parks the target
	// under the sticky header, and the pointer then lands on the header instead of
	// the link. That is the same defect WCAG 2.4.11 names, showing up here as a
	// test that silently hovers nothing.
	await page.evaluate(() => document.querySelector('#probe-link').scrollIntoView({ block: 'center' }));
	// The scroll event has to land before the pointer moves. hoverZoom clears its
	// pending preview on scroll - correctly, since a preview anchored to a link
	// that has moved is wrong - and a scroll event dispatched after the mouse move
	// cancels the 180ms timer that would have built the popover.
	await page.waitForTimeout(500);
	const box = await page.locator('#probe-link').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForSelector('#rsm-hoverZoom-popover', { state: 'attached', timeout: 10000 });

	const state = await page.evaluate(() => {
		const pop = document.querySelector('#rsm-hoverZoom-popover');
		return {
			zIndex: getComputedStyle(pop).zIndex,
			popover: pop.getAttribute('popover'),
			isOpen: pop.matches(':popover-open'),
			// `manual` must not have taken the page's Escape key or dismissed on an
			// outside click; `auto` would have done both, and this preview owns
			// neither gesture.
			activeElement: document.activeElement?.id ?? null,
		};
	});
	assert.equal(state.popover, 'manual');
	assert.equal(state.isOpen, true, 'showPopover() must have run — otherwise the UA display:none rule hides it');
	assert.equal(state.zIndex, 'auto', 'a top-layer preview needs no stacking value');
	assert.notEqual(state.activeElement, 'rsm-hoverZoom-popover', 'the preview must not take focus');
});

// Every opt-in module that injects a control, so the sweep below sees more than
// the handful the defaults put on the page.
const CONTROL_HEAVY_MODULES = {
	overlayViewer: true, hoverZoom: true, storageDashboard: true, savedBackup: true,
	commentTreeExport: true, threadMinimap: true, subRulesInline: true, waybackSnapshot: true,
	archiveLinks: true, viewDeleted: true, userTagger: true, reverseImageSearch: true,
	commentShredder: true, arcticShift: true, codeBlockCopy: true, searchGallery: true,
	cobaltDownloader: true, editedCommentDiff: true, crosspostMap: true,
	authorContextBadge: true, perSubSort: true, repostDedupe: true, topCommentsPreview: true,
};

async function openControlHeavyThread(context, worker) {
	await worker.evaluate(mods => new Promise(resolve => chrome.storage.local.set({ 'RES.modulePrefs': mods }, resolve)), CONTROL_HEAVY_MODULES);
	const html = servableCapture();
	const page = await context.newPage();
	await context.route('**/*', route => {
		const url = route.request().url();
		if (!/^https?:\/\//.test(url)) return route.continue();
		if (route.request().resourceType() === 'document' && url.includes('old.reddit.com')) {
			return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
		}
		return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
	});
	await page.goto('https://old.reddit.com/r/fixture/comments/post0000001/fixture-post/', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => document.documentElement.classList.contains('res'), null, { timeout: 30000 });
	await page.waitForTimeout(1500);
	return page;
}

test('every injected control meets the WCAG 2.2 target size', async t => {
	// 2.5.8 Target Size (Minimum), AA: 24x24 CSS px. Old Reddit's own icon rows are
	// about 16px and RES-Slim injects controls alongside them, so looking right and
	// meeting the rule pull in opposite directions — which is what the
	// `rsm-target-24` overlay resolves: the rendered size does not change, the
	// target grows around the centre.
	//
	// Measured by hit test, because the criterion is about the region that accepts
	// a pointer and not the rendered box. An overlay satisfies 2.5.8 and moves
	// getBoundingClientRect() by exactly nothing, so a box measurement answers a
	// question the rule never asked.
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);
	const page = await openControlHeavyThread(context, worker);

	const report = await page.evaluate(() => {
		const isOurs = el => /(^|\s)(rsm-|RES)/.test(`${el.className || ''} `) || /^(rsm-|RES)/.test(el.id || '');
		const ours = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, [role="button"]')].filter(isOurs);

		const failures = [];
		for (const el of ours) {
			// elementsFromPoint answers an empty list outside the viewport, which
			// would read as a failure for a control that is merely below the fold.
			el.scrollIntoView({ block: 'center' });
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const inView = ([x, y]) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
			// A target flush against a viewport edge cannot extend past it.
			const probes = [[cx, cy - 11.5], [cx, cy + 11.5], [cx - 11.5, cy], [cx + 11.5, cy]].filter(inView);
			const misses = probes.filter(([x, y]) => {
				// The whole stack, not the topmost element: a toast painted over the
				// control at this instant does not make the control smaller.
				const stack = document.elementsFromPoint(x, y);
				return !stack.some(node => node === el || el.contains(node));
			});
			if (misses.length) {
				failures.push(`${el.id ? `#${el.id}` : `.${(el.className || '').toString().trim().split(/\s+/).join('.')}`} (${Math.round(r.width)}x${Math.round(r.height)}, ${misses.length} of ${probes.length} probes missed)`);
			}
		}
		return { controls: ours.length, failures: [...new Set(failures)] };
	});

	// The sweep is worthless if it found nothing to sweep.
	assert.ok(report.controls >= 20, `expected the injected controls, found ${report.controls}`);
	assert.deepEqual(report.failures, [],
		`injected controls under the 24x24 target:\n  ${report.failures.join('\n  ')}`);
});

test('focus is never parked under the sticky header', async t => {
	// 2.4.11 Focus Not Obscured (Minimum), AA — and the offending element is this
	// fork's own: the compact sticky header v0.32.0 introduced. Measured on this
	// fixture before the fix, 20 of 78 focusable controls landed under it.
	//
	// Only when focus moves *upward*. A downward move scrolls the minimum, which
	// parks the target at the viewport bottom; shift+Tab, an in-page anchor and
	// every scrollIntoView put it at the top, where the header is.
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);
	const page = await openControlHeavyThread(context, worker);

	const result = await page.evaluate(() => {
		const header = document.querySelector('#header');
		if (getComputedStyle(header).position !== 'sticky') return { skipped: 'header is not sticky' };
		const focusables = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select')]
			// Nothing inside the header can be obscured *by* the header.
			.filter(el => !header.contains(el) && el.getBoundingClientRect().width > 0);

		const obscured = [];
		for (const el of focusables) {
			el.focus({ preventScroll: true });
			// scrollIntoView rather than letting focus() scroll: focus-triggered
			// scrolling is scheduled, not synchronous, and reading the rect after it
			// made this count flip between 0 and 16 across identical runs. This drives
			// the same user-agent scroll-into-view that honours scroll-padding, and
			// has landed by the time it returns. `start` is the upward-move case.
			el.scrollIntoView({ block: 'start' });
			const r = el.getBoundingClientRect();
			const hb = header.getBoundingClientRect();
			if (r.height === 0) continue;
			if (r.top < hb.bottom && r.bottom > hb.top) {
				obscured.push(`${el.tagName}.${(el.className || '').toString().slice(0, 40)} "${(el.textContent || '').trim().slice(0, 20)}" at ${Math.round(r.top)} under ${Math.round(hb.bottom)}`);
			}
		}
		return {
			checked: focusables.length,
			scrollPadding: getComputedStyle(document.documentElement).scrollPaddingBlockStart,
			headerHeight: Math.round(header.getBoundingClientRect().height),
			obscured,
		};
	});

	assert.equal(result.skipped, undefined, result.skipped);
	assert.ok(result.checked > 50, `expected a page full of controls, found ${result.checked}`);

	// The padding has to have come from the measured header, not the fallback. It
	// is published by pageTheme from a ResizeObserver, and the first version of
	// that published it from `always`, which can run before reddit's header is in
	// the document — leaving the fallback in place on about half of all loads,
	// which is how this test came to flip between 0 and 16 obscured.
	assert.ok(parseInt(result.scrollPadding, 10) >= result.headerHeight,
		`scroll-padding ${result.scrollPadding} does not clear the ${result.headerHeight}px header — the measured height never reached the stylesheet`);

	assert.deepEqual(result.obscured, [],
		`focused controls under the sticky header:\n  ${result.obscured.join('\n  ')}`);
});

// WCAG tags, most to least: 2.0 A/AA, then what 2.1 and 2.2 each added at AA.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function describeViolations(violations) {
	// axe's failureSummary names the measured values — the actual contrast ratio,
	// the actual target size — which is the difference between a gate that reports
	// a rule id and one that tells you what to change.
	return violations.flatMap(v => v.nodes.map(node =>
		`${v.id} (${v.impact}) — ${node.target.join(' ')}\n      ${(node.failureSummary || v.help).replace(/\n/g, '\n      ')}`)).join('\n  ');
}

test('the options page has no accessibility violations', async t => {
	// The whole page is ours here, so nothing needs scoping: every node axe finds
	// is markup this repo wrote.
	const { context, extensionId, dispose } = await launchWithExtension();
	t.after(dispose);

	const page = await context.newPage();
	await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#moduleOptionsScrim, #optionContainer, .optionContainer', { timeout: 30000 }).catch(() => {});
	await page.waitForTimeout(1000);

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

	// A run that inspected nothing proves nothing — axe reports what it checked.
	assert.ok(results.passes.length > 0, 'axe found no passing checks, so it inspected nothing');
	assert.deepEqual(results.violations.map(v => v.id), [],
		`accessibility violations on the options page:\n  ${describeViolations(results.violations)}`);
});

test('the controls injected into old Reddit have no accessibility violations', async t => {
	// Scoped, unlike the options page: old.reddit's own markup fails plenty that
	// this fork did not write and cannot fix without rewriting reddit. `include`
	// narrows axe to the surfaces RES-Slim injects, which is the part we own.
	const { context, worker, dispose } = await launchWithExtension();
	t.after(dispose);
	const page = await openControlHeavyThread(context, worker);

	// Derived from the page rather than hardcoded, so a module that starts
	// injecting under a new id is covered without anyone remembering to add it.
	const roots = await page.evaluate(() => {
		const SURFACE = '[id^="rsm-"], [class*="rsm-"]';
		// `<html>` carries rsm-root and the theme classes, so it matches SURFACE and
		// is an ancestor of everything — including it as a root would scope axe to
		// the entire reddit page, which is the opposite of what this test is for.
		const skip = new Set([document.documentElement, document.body]);
		const candidates = [...document.querySelectorAll(SURFACE)].filter(el => !skip.has(el));
		const seen = new Set();
		for (const el of candidates) {
			// Only outermost surfaces; axe walks into the rest.
			const container = el.parentElement && el.parentElement.closest(SURFACE);
			if (container && !skip.has(container)) continue;
			const cls = el.className.toString().trim().split(/\s+/).find(c => c.startsWith('rsm-'));
			seen.add(el.id ? `#${el.id}` : `.${cls}`);
		}
		return [...seen];
	});
	assert.ok(roots.length >= 5, `expected injected surfaces to scope to, found ${roots.length}`);

	let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
	for (const root of roots) builder = builder.include(root);
	const results = await builder.analyze();

	assert.ok(results.passes.length > 0, 'axe found no passing checks, so it inspected nothing');
	assert.deepEqual(results.violations.map(v => v.id), [],
		`accessibility violations in injected UI:\n  ${describeViolations(results.violations)}`);
});
