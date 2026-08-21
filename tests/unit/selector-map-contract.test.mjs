import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const selectorSource = read('lib/core/dom/selectors.js');
const selectorBundleSource = read('lib/core/dom/selector-bundle.v1.json');
const selectorBundle = JSON.parse(selectorBundleSource);
const {
	SELECTOR_BUNDLE_SCHEMA_VERSION,
	SELECTOR_BUNDLE_VERSION,
	findSurface,
	formatSelectorDriftMessage,
	getSelectorOverrides,
	getSurfaceSelectorList,
	getStableSelector,
	inspectSurfaceMatch,
	matchedSelectorFor,
	normalizeSelectorOverrides,
	parseSelectorOverrides,
	resetSelectorOverrides,
	selectorOverrideCount,
	selectorDriftForPage,
	serializeSelectorOverrides,
	setSelectorOverrides,
} =
	await loadFlowModule('lib/core/dom/selectors.js', 'selectors', {
		stubs: {
			'./selector-bundle.v1.json': `export default ${JSON.stringify(selectorBundle)};`,
		},
	});
const { JSDOM } = await import('jsdom');
const trustedHtml = read('lib/core/dom/trustedHtml.js');
const selectorStorageSource = read('lib/core/dom/selectorOverrideStorage.js');
const coreInitSource = read('lib/core/init.js');
const settingsSource = read('lib/options/settingsConsole.js');
const settingsTemplate = read('lib/options/templates.js');
const settingsStyles = read('lib/options/options.scss');
const frontpageFixture = read('tests/fixtures/mhtml/frontpage.html');
const threadFixture = read('tests/fixtures/mhtml/thread.html');

const requiredSurfaces = [
	'pageRoot',
	'header',
	'subredditBar',
	'userbar',
	'mail',
	'search',
	'listingFeed',
	'post',
	'postTitle',
	'postMetadata',
	'postActions',
	'voteColumn',
	'score',
	'expandoButton',
	'expando',
	'thumbnail',
	'sidebar',
	'commentArea',
	'commentList',
	'comment',
	'commentBody',
	'commentChildren',
	'collapseControl',
	'composerForm',
	'submitButton',
	'reportForm',
	'saveHideControls',
	'author',
	'profileListing',
	'modQueue',
	'settingsButton',
	'settingsOverlay',
];

function surfaceBlock(surfaceName) {
	const surface = selectorBundle.renderers.r2.surfaces[surfaceName];
	assert.ok(surface, `${surfaceName} is present in the selector bundle`);
	return surface;
}

test('old Reddit selector map records stable and fallback selectors for every key surface', () => {
	for (const surfaceName of requiredSurfaces) {
		const block = surfaceBlock(surfaceName);
		assert.ok(Array.isArray(block.stable), `${surfaceName} exposes stable selectors`);
		assert.ok(Array.isArray(block.fallback), `${surfaceName} exposes fallback selectors`);
	}

	assert.ok(surfaceBlock('listingFeed').stable.includes('#siteTable.sitetable.linklisting'));
	assert.ok(surfaceBlock('post').stable.includes('.thing.link[data-fullname][data-permalink]'));
	assert.ok(surfaceBlock('comment').stable.includes('.thing.comment[data-fullname][data-author]'));
	assert.ok(surfaceBlock('composerForm').stable.includes('form.usertext textarea[name="text"]'));
	assert.ok(surfaceBlock('search').stable.includes('#search[role="search"] input[name="q"]'));
	assert.ok(surfaceBlock('settingsButton').stable.includes('#RESSettingsButton'));
});

test('primary stable selectors avoid old Reddit churn-prone styling classes', () => {
	for (const surfaceName of requiredSurfaces) {
		const stableBlock = surfaceBlock(surfaceName).stable.join('\n');
		assert.doesNotMatch(stableBlock, /res-v0(?:-\d+-\d+)?/);
		assert.doesNotMatch(stableBlock, /\.odd\b/);
		assert.doesNotMatch(stableBlock, /\.even\b/);
	}

	assert.ok(surfaceBlock('post').fallback.some(selector => selector.includes('.link.odd')));
	assert.ok(surfaceBlock('post').fallback.some(selector => selector.includes('.link.even')));
});

// `appType()` in lib/utils/currentLocation.js reports 'r2' (old reddit) purely on
// the presence of the xmlns attribute, and falls back to 'd2x' (the redesign)
// without it — and ~40 modules declare `module.include = ['r2']`, so on 'd2x' they
// never run. Both fixtures shipped without the attribute the real captures carry,
// which meant every assertion in this file described a document the product would
// have treated as new reddit. Found by the e2e harness, pinned here because this
// file is what the rest of the suite trusts.
test('fixtures carry the marker that makes the extension treat them as old reddit', () => {
	for (const [name, fixture] of [['frontpage', frontpageFixture], ['thread', threadFixture]]) {
		assert.match(fixture, /<html[^>]*\sxmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/, `${name} fixture must declare the old-reddit xmlns`);
	}
});

test('fresh sanitized fixtures preserve front page and thread DOM surfaces', () => {
	for (const fixture of [frontpageFixture, threadFixture]) {
		assert.match(fixture, /Sanitized from capture\.html captured 2026-08-13T12:00:00\.000Z; structural fixture only; sha256:[a-f0-9]{12}/);
	}

	const frontpage = new JSDOM(frontpageFixture).window.document;
	assert.ok(frontpage.body.classList.contains('listing-page'));
	assert.ok(frontpage.querySelector('#sr-header-area'));
	assert.ok(frontpage.querySelector('#header[role="banner"]'));
	assert.ok(frontpage.querySelector('#header-bottom-right'));
	assert.ok(frontpage.querySelector('#mail'));
	assert.ok(frontpage.querySelector('#siteTable.sitetable.linklisting'));
	assert.ok(frontpage.querySelector('.thing.link[data-fullname^="t3_"][data-permalink]'));
	assert.ok(frontpage.querySelector('#search[role="search"] input[name="q"]'));
	assert.ok(frontpage.querySelector('.expando-button'));
	assert.ok(frontpage.querySelector('.side'));

	const thread = new JSDOM(threadFixture).window.document;
	assert.ok(thread.body.classList.contains('comments-page'));
	assert.ok(thread.body.classList.contains('single-page'));
	assert.ok(thread.querySelector('.commentarea'));
	assert.ok(thread.querySelector('.sitetable.nestedlisting'));
	assert.ok(thread.querySelector('.thing.comment[data-author]'));
	assert.ok(thread.querySelector('.expand'));
	assert.ok(thread.querySelector('.usertext-body'));
	assert.ok(thread.querySelector('form.usertext textarea[name="text"]'));
	assert.ok(thread.querySelector('.reportform'));
	assert.ok(thread.querySelector('.child'));
});

test('high-churn surfaces are enumerated', () => {
	assert.match(selectorSource, /highChurnSurfaces = Object\.freeze\(\[/);
	for (const surfaceName of ['expando', 'commentChildren', 'composerForm', 'reportForm', 'settingsOverlay']) {
		assert.match(selectorSource, new RegExp(`'${surfaceName}'`));
	}
});

test('selector data is versioned separately from the resolver', () => {
	assert.equal(selectorBundle.schemaVersion, 1);
	assert.match(selectorBundle.bundleVersion, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
	assert.equal(SELECTOR_BUNDLE_SCHEMA_VERSION, selectorBundle.schemaVersion);
	assert.equal(SELECTOR_BUNDLE_VERSION, selectorBundle.bundleVersion);
	assert.doesNotMatch(selectorSource, /#siteTable\.sitetable\.linklisting/);
});

test('validated user selectors replace bundle values and preserve unspecified lists', () => {
	resetSelectorOverrides();
	const originalFallbacks = surfaceBlock('header').fallback;
	const overrides = normalizeSelectorOverrides({
		schemaVersion: 1,
		bundleVersion: 'older-bundle',
		selectors: { r2: { header: { stable: ['header[data-res-custom]'] } } },
	}, selector => new JSDOM('<header data-res-custom></header>').window.document.querySelector(selector));

	setSelectorOverrides(overrides);
	assert.deepEqual(getSurfaceSelectorList('header'), ['header[data-res-custom]', ...originalFallbacks]);
	assert.equal(getStableSelector('header'), 'header[data-res-custom]');
	assert.equal(selectorOverrideCount(), 1);
	assert.equal(getSelectorOverrides().bundleVersion, SELECTOR_BUNDLE_VERSION);
	resetSelectorOverrides();
});

test('drift detection resolves the active override instead of a second selector map', () => {
	const stableRoot = new JSDOM(frontpageFixture).window.document;
	resetSelectorOverrides();
	setSelectorOverrides({
		schemaVersion: 1,
		selectors: { r2: { listingFeed: { stable: ['#user-repaired-feed'], fallback: [] } } },
	});
	assert.deepEqual(selectorDriftForPage('linklist', stableRoot).map(finding => finding.surfaceName), ['listingFeed']);
	stableRoot.querySelector('#siteTable').id = 'user-repaired-feed';
	assert.deepEqual(selectorDriftForPage('linklist', stableRoot), []);
	resetSelectorOverrides();
});

test('override parser rejects unknown surfaces, malformed CSS, duplicates, and empty stable lists', () => {
	const probe = selector => new JSDOM('').window.document.querySelector(selector);
	const make = header => JSON.stringify({ schemaVersion: 1, selectors: { r2: { header } } });
	assert.throws(() => parseSelectorOverrides(JSON.stringify({ schemaVersion: 1, selectors: { r2: { missing: { stable: ['body'] } } } })), /Unknown r2 surface/);
	assert.throws(() => parseSelectorOverrides(make({ stable: ['div>>broken'] }), probe), /not valid CSS/);
	assert.throws(() => parseSelectorOverrides(make({ stable: ['body', 'body'] }), probe), /duplicate selector/);
	assert.throws(() => parseSelectorOverrides(make({ stable: [] }), probe), /needs at least one selector/);
	assert.throws(() => parseSelectorOverrides('{not json'), /not valid JSON/);
});

test('override exports are deterministic and carry the active bundle version', () => {
	resetSelectorOverrides();
	setSelectorOverrides({ schemaVersion: 1, selectors: { d2x: { post: { fallback: ['article[data-post]'] } } } });
	const serialized = serializeSelectorOverrides();
	assert.equal(serialized, `${JSON.stringify(getSelectorOverrides(), null, 2)}\n`);
	assert.match(serialized, new RegExp(`"bundleVersion": "${SELECTOR_BUNDLE_VERSION.replaceAll('.', '\\.')}"`));
	resetSelectorOverrides();
});

test('override storage loads before modules and the console exposes save, import, export, and restore', () => {
	assert.match(selectorStorageSource, /Storage\.wrap\(SELECTOR_OVERRIDE_STORAGE_KEY/);
	assert.match(selectorStorageSource, /setSelectorOverrides\(stored\)/);
	assert.match(coreInitSource, /loadOptions[\s\S]*loadSelectorOverrides\(\)[\s\S]*_loadModuleOptions\(\)/);
	for (const id of ['RESSelectorOverrideEditor', 'RESSelectorOverrideSave', 'RESSelectorOverrideImport', 'RESSelectorOverrideExport', 'RESSelectorOverrideReset']) {
		assert.match(settingsTemplate, new RegExp(`id="${id}"`));
	}
	assert.match(settingsSource, /parseSelectorOverrides\(editor\.value\)/);
	assert.match(settingsSource, /saveSelectorOverrides/);
	assert.match(settingsSource, /clearSelectorOverrides/);
	assert.match(settingsStyles, /\.utilityPanel--selectors[\s\S]*grid-column: 1 \/ -1/);
});

test('findSurface falls back through the list in order', () => {
	// The point of the map: a module that hardcodes one selector silently
	// no-ops when Reddit renames a class — nothing throws, the feature just
	// stops appearing. Exercised against a stub root rather than asserted about,
	// because the ordering is the whole behaviour.
	const list = getSurfaceSelectorList('header');
	assert.ok(list.length > 1, 'header needs at least one fallback to be worth resolving');

	const element = { nodeType: 1 };
	const rootMatching = matched => ({ querySelector: sel => (sel === matched ? element : null) });

	// Stable selector present: used directly.
	assert.equal(matchedSelectorFor('header', rootMatching(list[0])), list[0]);
	// Stable selector gone, fallback present: resolves anyway.
	assert.equal(matchedSelectorFor('header', rootMatching(list[1])), list[1]);
	// Nothing matches: null rather than a throw, so a caller can degrade.
	assert.equal(matchedSelectorFor('header', { querySelector: () => null }), null);
});

test('live diagnostics distinguish stable, fallback, and missing fixture variants', () => {
	const stableRoot = new JSDOM(frontpageFixture).window.document;
	assert.deepEqual(selectorDriftForPage('linklist', stableRoot), [], 'the canonical fixture should resolve every required surface stably');

	const fallbackFixture = frontpageFixture.replace(
		'id="siteTable" class="sitetable linklisting"',
		'id="legacySiteTable" class="sitetable linklisting"',
	);
	const fallbackRoot = new JSDOM(fallbackFixture).window.document;
	assert.deepEqual(inspectSurfaceMatch('listingFeed', fallbackRoot), {
		surfaceName: 'listingFeed',
		status: 'fallback',
		selector: '.linklisting .thing.link',
	});
	assert.deepEqual(selectorDriftForPage('linklist', fallbackRoot).map(finding => finding.surfaceName), ['listingFeed']);

	const missingRoot = new JSDOM(fallbackFixture).window.document;
	for (const post of missingRoot.querySelectorAll('.thing.link')) post.classList.remove('link');
	assert.deepEqual(inspectSurfaceMatch('listingFeed', missingRoot), {
		surfaceName: 'listingFeed',
		status: 'missing',
		selector: null,
	});
	const message = formatSelectorDriftMessage('linklist', selectorDriftForPage('linklist', missingRoot));
	assert.match(message, /listingFeed is missing/);
	assert.deepEqual(selectorDriftForPage('prefs', missingRoot), [], 'unmapped page types must not produce false alarms');
});

test('findSurface returns only real elements', () => {
	// querySelector on a detached or exotic root can hand back a non-element;
	// returning it would push the failure into the caller. The check is on
	// nodeType, not `instanceof HTMLElement`, because a content script can be
	// handed an element from another realm where instanceof is false.
	const notAnElement = { nodeType: 3 };
	assert.equal(findSurface('header', { querySelector: () => notAnElement }), null);

	const realElement = { nodeType: 1 };
	assert.equal(findSurface('header', { querySelector: () => realElement }), realElement);
});

test('an unknown surface name fails loudly', () => {
	// A typo must not resolve to null and look like "not on this page".
	assert.throws(() => getSurfaceSelectorList('nosuchsurface'), /Unknown Old Reddit surface/);
	assert.throws(() => getStableSelector('nosuchsurface'), /Unknown Old Reddit surface/);
});

test('the selector map is actually used by shipping code', () => {
	// It was built and left unimported, which made it a liability rather than the
	// resilience asset it was written to be.
	const hideAll = read('lib/modules/hideAll.js');
	const randomSubreddit = read('lib/modules/randomSubreddit.js');
	assert.match(hideAll, /import \{ findSurface \} from '\.\.\/core\/dom\/selectors'/);
	assert.match(hideAll, /findSurface\('header'\)/);
	assert.match(randomSubreddit, /findSurface\('subredditBar'\)/);
});
test('TrustedTypes helper centralizes all HTML injection primitives', () => {
	assert.match(trustedHtml, /trustedTypes\.createPolicy\(POLICY_NAME/);
	assert.match(trustedHtml, /createTrustedHTML\(html: string\)/);
	assert.match(trustedHtml, /setTrustedHTML\(element: HTMLElement/);
	assert.match(trustedHtml, /insertTrustedHTML\(element: HTMLElement/);
	assert.match(trustedHtml, /element\.innerHTML = createTrustedHTML\(html\)/);
	assert.match(trustedHtml, /element\.insertAdjacentHTML\(position, createTrustedHTML\(html\)\)/);
});
