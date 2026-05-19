import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const selectors = read('lib/core/dom/selectors.js');
const findElement = read('lib/core/dom/findElement.js');
const waitForElement = read('lib/core/dom/waitForElement.js');
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

test('selector helper strategy supports self-healing lookups without full-document mutation scans', () => {
	assert.match(selectors, /highChurnSurfaces = Object\.freeze\(\[/);
	for (const surfaceName of ['expando', 'commentChildren', 'composerForm', 'reportForm', 'settingsOverlay']) {
		assert.match(selectors, new RegExp(`'${surfaceName}'`));
	}

	assert.match(findElement, /root\.querySelector\(selector\)/);
	assert.match(findElement, /root\.querySelectorAll\(selector\)/);
	assert.match(findElement, /getSurfaceSelectorList\(surfaceName\)/);
	assert.match(waitForElement, /new MutationObserver/);
	assert.match(waitForElement, /mutation\.addedNodes/);
	assert.match(waitForElement, /findInAddedNode\(node, selectorList\)/);
	assert.match(waitForElement, /backoffMs/);
	assert.doesNotMatch(waitForElement, /document\.querySelectorAll/);
});

test('TrustedTypes helper centralizes all HTML injection primitives', () => {
	assert.match(trustedHtml, /trustedTypes\.createPolicy\(POLICY_NAME/);
	assert.match(trustedHtml, /createTrustedHTML\(html: string\)/);
	assert.match(trustedHtml, /setTrustedHTML\(element: HTMLElement/);
	assert.match(trustedHtml, /insertTrustedHTML\(element: HTMLElement/);
	assert.match(trustedHtml, /element\.innerHTML = createTrustedHTML\(html\)/);
	assert.match(trustedHtml, /element\.insertAdjacentHTML\(position, createTrustedHTML\(html\)\)/);
});
