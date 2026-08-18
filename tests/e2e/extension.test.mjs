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
	assert.equal(state.searchExpandoRadius, '7px', 'the search helper should match the field geometry');
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

	const accent = page.locator('#accent');
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
