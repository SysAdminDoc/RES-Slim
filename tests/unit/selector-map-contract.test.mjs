import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const selectors = read('lib/core/dom/selectors.js');
const { findSurface, matchedSelectorFor, getSurfaceSelectorList, getStableSelector } =
	await loadFlowModule('lib/core/dom/selectors.js', 'selectors');
const trustedHtml = read('lib/core/dom/trustedHtml.js');
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
	const match = selectors.match(new RegExp(`\\n\\t${surfaceName}: \\{[\\s\\S]*?\\n\\t\\},`));
	assert.ok(match, `${surfaceName} is present in the selector map`);
	return match[0];
}

test('old Reddit selector map records stable and fallback selectors for every key surface', () => {
	for (const surfaceName of requiredSurfaces) {
		const block = surfaceBlock(surfaceName);
		assert.match(block, /stable: \[/, `${surfaceName} exposes stable selectors`);
		assert.match(block, /fallback: \[/, `${surfaceName} exposes fallback selectors`);
	}

	assert.match(selectors, /#siteTable\.sitetable\.linklisting/);
	assert.match(selectors, /\.thing\.link\[data-fullname\]\[data-permalink\]/);
	assert.match(selectors, /\.thing\.comment\[data-fullname\]\[data-author\]/);
	assert.match(selectors, /form\.usertext textarea\[name="text"\]/);
	assert.match(selectors, /#search\[role="search"\] input\[name="q"\]/);
	assert.match(selectors, /#RESSettingsButton/);
});

test('primary stable selectors avoid old Reddit churn-prone styling classes', () => {
	for (const surfaceName of requiredSurfaces) {
		const stableBlock = surfaceBlock(surfaceName).match(/stable: \[[\s\S]*?\],/)[0];
		assert.doesNotMatch(stableBlock, /res-v0(?:-\d+-\d+)?/);
		assert.doesNotMatch(stableBlock, /\.odd\b/);
		assert.doesNotMatch(stableBlock, /\.even\b/);
	}

	assert.match(surfaceBlock('post'), /\.link\.odd/);
	assert.match(surfaceBlock('post'), /\.link\.even/);
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

test('MHTML-derived fixtures preserve front page and thread DOM surfaces', () => {
	assert.match(frontpageFixture, /Derived from reddit_ the front page of the internet\.mhtml/);
	assert.match(frontpageFixture, /<body class="listing-page/);
	assert.match(frontpageFixture, /id="sr-header-area"/);
	assert.match(frontpageFixture, /id="header" role="banner"/);
	assert.match(frontpageFixture, /id="header-bottom-right"/);
	assert.match(frontpageFixture, /id="mail"/);
	assert.match(frontpageFixture, /id="RESSettingsButton"/);
	assert.match(frontpageFixture, /id="siteTable" class="sitetable linklisting"/);
	assert.match(frontpageFixture, /class="thing link/);
	assert.match(frontpageFixture, /data-fullname="t3_/);
	assert.match(frontpageFixture, /data-permalink="/);
	assert.match(frontpageFixture, /role="search"/);
	assert.match(frontpageFixture, /name="q"/);
	assert.match(frontpageFixture, /class="expando-button/);
	assert.match(frontpageFixture, /class="side"/);

	assert.match(threadFixture, /Derived from This has to stop, They are taking our limits/);
	assert.match(threadFixture, /<body class="[^"]*comments-page[^"]*single-page/);
	assert.match(threadFixture, /class="commentarea"/);
	assert.match(threadFixture, /class="sitetable nestedlisting"/);
	assert.match(threadFixture, /class="thing comment/);
	assert.match(threadFixture, /data-author="/);
	assert.match(threadFixture, /class="expand"/);
	assert.match(threadFixture, /class="usertext-body"/);
	assert.match(threadFixture, /form class="usertext"/);
	assert.match(threadFixture, /textarea name="text"/);
	assert.match(threadFixture, /class="reportform"/);
	assert.match(threadFixture, /class="child"/);
});

test('high-churn surfaces are enumerated', () => {
	assert.match(selectors, /highChurnSurfaces = Object\.freeze\(\[/);
	for (const surfaceName of ['expando', 'commentChildren', 'composerForm', 'reportForm', 'settingsOverlay']) {
		assert.match(selectors, new RegExp(`'${surfaceName}'`));
	}
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
	assert.throws(() => getSurfaceSelectorList('nosuchsurface'), /Unknown old Reddit surface/);
	assert.throws(() => getStableSelector('nosuchsurface'), /Unknown old Reddit surface/);
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
