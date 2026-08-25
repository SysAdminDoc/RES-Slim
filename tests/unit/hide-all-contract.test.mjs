import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const mod = read('lib/modules/hideAll.js');
const scss = read('lib/css/modules/_hideAll.scss');

// The module's header explains what the original userscript did, naming the
// reddit internals it borrowed. Those names are prose, not calls, so the
// page-world checks below run against code with comments stripped.
const modCode = mod
	.replace(/\/\*[\s\S]*?\*\//g, '')
	// Split on \r?\n and strip with a character class rather than `.*$`: on a CRLF
	// checkout the trailing \r is not a line terminator to `.`, so `$` never
	// matches and every line comment survives, silently disarming the checks below.
	.split(/\r?\n/)
	.map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1'))
	.join('\n');

test('hideAll is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as hideAll \} from '\.\/hideAll'/);
	assert.match(index, /\n\thideAll,/);
});

test('hideAll ships its stylesheet through res.scss', () => {
	assert.match(read('lib/css/res.scss'), /@import 'modules\/hideAll';/);
	assert.match(scss, /\.rsm-hideAll-link/);
});

test('hideAll is opt-in and scoped to listing pages', () => {
	assert.match(mod, /module\.disabledByDefault = true/);
	assert.match(mod, /module\.include = \['linklist', 'search', 'profile'\]/);
	assert.match(mod, /isPageType\('linklist', 'search', 'profile'\)/);
});

test('hideAll never borrows reddit page-world JavaScript', () => {
	// The userscript this replaces appended a <script> element so it could call
	// reddit's own jQuery helpers. A content script must not do that: the page
	// CSP can refuse it, and reddit's internals are not an API.
	assert.doesNotMatch(modCode, /createElement\('script'\)/);
	assert.doesNotMatch(modCode, /get_form_fields|thing_id\(\)|hide_thing|reddit\.modhash/);
	assert.doesNotMatch(modCode, /document\.evaluate|XPathResult/);
	// And it must not report through a blocking dialog.
	assert.doesNotMatch(modCode, /\balert\(|\bconfirm\(/);
	assert.match(modCode, /showNotification\(/);

	// The comment-stripper has to actually strip, or the checks above pass for
	// the wrong reason.
	assert.match(mod, /get_form_fields/, 'the header should still describe the original');
	assert.doesNotMatch(modCode, /Greasy Fork/);
});

test('hideAll refuses to run without a modhash rather than failing silently', () => {
	// reddit answers 403 or quietly ignores the POST, so the posts stay visible
	// while the run looks successful. markAllRead sets the same precedent.
	assert.match(mod, /function modhash\(\)/);
	assert.match(mod, /if \(!uh\) \{/);
    assert.match(mod, /could not read your login token/);
});

test('hideAll throttles its requests', () => {
	// One unthrottled POST per post is what the original author complained about
	// in his own source comments.
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /limiter\.schedule\(/);
	assert.match(mod, /requestsPerSecond/);
});

test('hideAll is reversible, and the undo reports its own failures', () => {
	assert.match(mod, /'\/api\/hide'/);
	assert.match(mod, /'\/api\/unhide'/);
	assert.match(mod, /async function undo\(/);
	assert.match(mod, /Undo/);
	// A partial undo must not read as a complete one.
	assert.match(mod, /couldn\\'t be restored/);
});

test('hideAll only targets visible, unhidden posts it has a fullname for', () => {
	assert.match(mod, /Thing\.visibleThings\(document\)/);
	assert.match(mod, /thing\.isPost\(\)/);
	assert.match(mod, /if \(!thing\.getFullname\(\)\) return false/);
	assert.match(mod, /classList\.contains\('hidden'\)/);
	assert.match(mod, /skipStickied/);
});

test('hideAll reports an empty run instead of doing nothing visible', () => {
	assert.match(mod, /Nothing left to hide on this page/);
});

test('the source userscript is credited but never vendored or shipped', () => {
	// This repo rewrites userscripts rather than bundling them — the sources are
	// third-party and separately licensed, so only the provenance is recorded.
	// The file itself stays untracked, which is why nothing here asserts it
	// exists: that would fail for anyone who clones the repo.
	assert.match(mod, /Reddit Hide All/, 'the module header should credit the original');
	assert.match(mod, /Greasy Fork/, 'the module header should cite where it came from');

	assert.doesNotMatch(read('build.js'), /Reddit_Hide_All/);
	for (const file of fs.readdirSync(path.join(repoRoot, 'lib/modules')).filter(f => f.endsWith('.js'))) {
		assert.doesNotMatch(read(`lib/modules/${file}`), /Reddit_Hide_All\.user/,
			`${file} must not import the reference userscript`);
	}
	// And a stray copy must never become part of the build. The exclusion moved
	// from `.eslintignore` to the `ignores` block of `eslint.config.js` when the
	// ESLint 10 migration removed eslintrc — flat config does not read
	// `.eslintignore` at all, and would have started linting a third-party
	// userscript rather than skipping it.
	assert.match(read('eslint.config.js'), /'\*\.user\.js'/);
});

// --- the undo that survives leaving the page ---------------------------------
//
// Everything above reads source. These run the module: the undo used to be a
// closure over an in-memory array, offered from a notification that closes after
// fifteen seconds, so hiding a hundred posts by accident was recoverable for
// fifteen seconds and not at all after a reload — which is exactly what a user
// does next. /api/unhide needs only the fullname, so the set persists.

import { loadModule } from './helpers/loadModule.mjs';

// The header markup matters: `injectLink` goes through the surface map, whose
// `header` entry is `#header[role="banner"]` with `#header-bottom-left .tabmenu`
// as the fallback. A bare `.tabmenu` matches neither, and the module would
// silently inject nothing.
const LISTING = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body class="listing-page">
	<input type="hidden" name="uh" value="test-modhash" />
	<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
	<div class="content" role="main">
		<div id="siteTable">
			<div class="thing link" data-fullname="t3_keep" data-url="https://example.com/keep"><div class="entry"><p class="title"><a class="title" href="/r/x/comments/keep/t/">Kept</a></p></div></div>
		</div>
	</div>
</body></html>`;

// `loadModule` installs the document itself, so the listing has to be handed to
// it — calling `installDom` first is overwritten by the one inside.
const HideAll = await loadModule('lib/modules/hideAll.js', 'hide-all-run', {
	dom: { url: 'https://old.reddit.com/r/test/', html: LISTING },
});

const storageSet = items => new Promise(resolve => { chrome.storage.local.set(items, resolve); });
const storageGet = key => new Promise(resolve => { chrome.storage.local.get(key, r => resolve(r[key])); });

function freshListing() {
	document.body.innerHTML = LISTING.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
}

async function contentStartWith(run) {
	freshListing();
	if (run === null) await new Promise(resolve => chrome.storage.local.remove('RES.hideAll.lastRun', resolve));
	else await storageSet({ 'RES.hideAll.lastRun': run });

	HideAll.module.contentStart();
	// The stored run is read asynchronously, so the link appears a microtask
	// later than the "hide all" link beside it.
	await new Promise(resolve => setTimeout(resolve, 0));
}

test('a recent run puts the undo back after a reload', async () => {
	await contentStartWith({ fullnames: ['t3_a', 't3_b', 't3_c'], at: Date.now() - 60000 });

	const undo = document.querySelector('.rsm-hideAll-undo-link a');
	assert.ok(undo, 'the undo must survive the notification that offered it');
	assert.match(undo.textContent, /undo hide all/);
	assert.match(undo.title, /Restore the 3 posts/, 'it should say how much it will restore');
	assert.ok(document.querySelector('.rsm-hideAll-link'), 'and the hide-all link stays where it was');
});

test('an expired run offers nothing, so the link never lies about what it can restore', async () => {
	await contentStartWith({ fullnames: ['t3_a'], at: Date.now() - (31 * 60 * 1000) });
	assert.equal(document.querySelector('.rsm-hideAll-undo-link'), null, 'a run outside the window must not be offered');

	await contentStartWith({ fullnames: [], at: Date.now() });
	assert.equal(document.querySelector('.rsm-hideAll-undo-link'), null, 'an empty run is not a run');

	await contentStartWith(null);
	assert.equal(document.querySelector('.rsm-hideAll-undo-link'), null, 'and nothing stored offers nothing');
});

test('a stored run is what the undo replays, not the DOM in front of it', async () => {
	// The posts a run hid are usually not on the page any more by the time the
	// user undoes it — that is the whole point. Only the fullnames are needed.
	const stored = { fullnames: ['t3_gone1', 't3_gone2'], at: Date.now() };
	await contentStartWith(stored);

	const requested = [];
	globalThis.__fetchHook = url => {
		requested.push(String(url));
		return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
	};

	document.querySelector('.rsm-hideAll-undo-link a').click();
	await new Promise(resolve => setTimeout(resolve, 200));

	const unhides = requested.filter(url => url.includes('/api/unhide'));
	assert.equal(unhides.length, 2, `both stored posts should be unhidden, saw ${requested.join(', ')}`);
	assert.equal(await storageGet('RES.hideAll.lastRun'), undefined, 'a clean undo clears the offer');

	globalThis.__fetchHook = null;
});
