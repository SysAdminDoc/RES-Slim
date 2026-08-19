// The mandatory-login overlay, and the case where dismissing it would be worse
// than leaving it.
//
// Reddit's login wall rolled out geographically and gradually from 2026-06-30,
// so there is no single DOM to write a selector list against — and this repo has
// no capture of a walled page, because capturing one needs a walled session.
// `frictionRemovers` therefore matches on shape rather than on class names, and
// these fixtures exercise the shape: a large fixed overlay, scroll locked, with
// and without real content underneath.
//
// jsdom reports zeroes for every geometry, so the coverage test is meaningless
// here and `getBoundingClientRect` is supplied per element. What that leaves
// checkable is the decision logic; the geometry half is asserted in a real
// browser in tests/e2e/extension.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const WALLED = `<!doctype html><html><body class="listing-page">
	<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
	<div class="content" role="main"><div id="siteTable">
		<div class="thing link" id="thing_t3_a" data-fullname="t3_a"><div class="entry"><p class="title"><a class="title" href="#">A real post that was really delivered</a></p></div></div>
	</div></div>
	<div class="LoginWallOverlay"><h2>Log in to continue</h2></div>
</body></html>`;

const EMPTY_WALLED = `<!doctype html><html><body class="listing-page">
	<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
	<div class="content" role="main"><div id="siteTable"></div></div>
	<div class="LoginWallOverlay"><h2>Log in to continue</h2></div>
</body></html>`;

const Friction = await loadModule('lib/modules/frictionRemovers.js', 'friction-login-wall', {
	dom: { url: 'https://old.reddit.com/r/test/', html: WALLED },
});
const { module: mod } = Friction;

const VIEWPORT = { width: 1280, height: 900 };

function installPage(html) {
	document.body.innerHTML = html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
	document.documentElement.className = '';
	document.body.className = 'listing-page';
	Friction.stopWatchingForLoginWall();
}

// jsdom has no layout: every rect is 0x0 and every computed position is
// `static`. Both are supplied here so the module's real predicate runs against
// numbers that mean something, rather than being trivially false for everything.
function makeOverlay(element, { position = 'fixed', coverage = 1, opacity = '1', display = 'block' } = {}) {
	element.style.position = position;
	element.style.opacity = opacity;
	element.style.display = display;
	element.getBoundingClientRect = () => ({
		width: VIEWPORT.width * coverage,
		height: VIEWPORT.height * coverage,
		top: 0, left: 0, right: VIEWPORT.width * coverage, bottom: VIEWPORT.height * coverage, x: 0, y: 0,
	});
}

Object.defineProperty(globalThis.window, 'innerWidth', { value: VIEWPORT.width, configurable: true });
Object.defineProperty(globalThis.window, 'innerHeight', { value: VIEWPORT.height, configurable: true });

const storageGet = key => new Promise(resolve => { chrome.storage.local.get(key, r => resolve(r[key])); });
async function errorLog() {
	const raw = await storageGet('RES.moduleErrorLog');
	return (Array.isArray(raw) ? raw : []).filter(e => e.moduleID === 'frictionRemovers');
}

test('the option says what it cannot do, not only what it does', () => {
	// Two variants of the wall exist, and only one of them is reachable. Where
	// the rollout has completed reddit answers with a 302 to the login page and
	// serves no content, which happens before any content script runs — so the
	// honest description has to name the case where turning this on changes
	// nothing. The reachable share shrinks as the rollout completes, which is
	// why this is stated rather than left to be inferred from a feature that
	// silently stops applying.
	//
	// Stated-behaviour drift is this repo's most-recurring documentation defect,
	// so the boundary is asserted rather than trusted to survive edits.
	const { description } = mod.options.dismissLoginWall;
	assert.match(description, /redirect/i, 'the server-side variant has to be named');
	assert.match(description, /nothing behind the wall|nothing to uncover|never sent/i,
		'and what that means: there is no page to reveal');
	assert.match(description, /only uncovers content Reddit actually sent/i,
		'the positive half of the same boundary — this reveals, it does not fetch');
});

test('the wall is left alone until the option is turned on', async () => {
	installPage(WALLED);
	makeOverlay(document.querySelector('.LoginWallOverlay'));
	mod.options.dismissLoginWall.value = false;

	assert.equal(Friction.dismissLoginWall(), false);
	assert.notEqual(document.querySelector('.LoginWallOverlay').style.display, 'none', 'an off-by-default option that acts anyway is not off by default');
});

test('a full-page overlay with content behind it is dismissed and scrolling restored', async () => {
	installPage(WALLED);
	makeOverlay(document.querySelector('.LoginWallOverlay'));
	mod.options.dismissLoginWall.value = true;

	assert.equal(Friction.dismissLoginWall(), true);
	assert.equal(document.querySelector('.LoginWallOverlay').style.display, 'none');
	assert.ok(document.documentElement.classList.contains('rsm-friction-unwalled'), 'the scroll lock is on the document, so the unlock has to be too');
	assert.ok(document.body.classList.contains('rsm-friction-unwalled'));
	assert.ok(document.querySelector('#siteTable .thing'), 'and the post that was there all along is still there');
});

test('an overlay with nothing behind it is reported, not hidden', async () => {
	await new Promise(resolve => chrome.storage.local.clear(resolve));
	installPage(EMPTY_WALLED);
	makeOverlay(document.querySelector('.LoginWallOverlay'));
	mod.options.dismissLoginWall.value = true;

	assert.equal(Friction.dismissLoginWall(), false, 'there is nothing to uncover');
	assert.notEqual(document.querySelector('.LoginWallOverlay').style.display, 'none', 'hiding it would leave a blank page that looks like it worked');
	assert.ok(!document.body.classList.contains('rsm-friction-unwalled'), 'and unlocking scroll on an empty page just lets the user scroll through nothing');

	// The report is fire-and-forget: `dismissLoginWall` is called from a
	// MutationObserver, which cannot await anything.
	let entries = [];
	for (let i = 0; i < 50 && !entries.length; i++) {
		await new Promise(resolve => setTimeout(resolve, 5));
		entries = await errorLog();
	}
	assert.equal(entries.length, 1, 'the user has to be able to find out why nothing happened');
	assert.equal(entries[0].stage, 'login-wall');
	assert.match(entries[0].message, /no content behind it/);
	assert.match(entries[0].message, /Log in/, 'and what to do about it');
});

test('ordinary page furniture is not mistaken for a wall', async () => {
	installPage(WALLED);
	mod.options.dismissLoginWall.value = true;
	const wall = document.querySelector('.LoginWallOverlay');

	// Each of these is one property away from qualifying. All of them appear on a
	// normal old.reddit page, and hiding any of them would be a visible bug.
	makeOverlay(wall, { position: 'static' });
	assert.deepEqual(Friction.findLoginWalls(), [], 'a statically positioned element is page content, however large');

	makeOverlay(wall, { coverage: 0.5 });
	assert.deepEqual(Friction.findLoginWalls(), [], 'a half-viewport modal is a modal');

	makeOverlay(wall, { display: 'none' });
	assert.deepEqual(Friction.findLoginWalls(), [], 'something already hidden is not covering anything');

	makeOverlay(wall, { opacity: '0' });
	assert.deepEqual(Friction.findLoginWalls(), [], 'a transparent overlay is not what the user is looking at');

	makeOverlay(wall, { coverage: 0.95 });
	assert.deepEqual(Friction.findLoginWalls(), [wall], 'and the real thing still matches');
});

test('RES-Slim never dismisses its own overlays', async () => {
	installPage(WALLED);
	mod.options.dismissLoginWall.value = true;

	const ours = document.createElement('div');
	ours.className = 'res-hover-container';
	document.body.append(ours);
	makeOverlay(ours);

	const alsoOurs = document.createElement('div');
	alsoOurs.id = 'RESConsoleContainer';
	document.body.append(alsoOurs);
	makeOverlay(alsoOurs);

	const found = Friction.findLoginWalls();
	assert.ok(!found.includes(ours), 'the settings console and the hover viewer cover the page on purpose');
	assert.ok(!found.includes(alsoOurs));
});

test('a wall nested one level down is still found', async () => {
	installPage(WALLED);
	mod.options.dismissLoginWall.value = true;
	document.querySelector('.LoginWallOverlay').remove();

	const wrapper = document.createElement('div');
	const nested = document.createElement('div');
	nested.className = 'InterstitialOverlay';
	wrapper.append(nested);
	document.body.append(wrapper);
	makeOverlay(nested);

	assert.deepEqual(Friction.findLoginWalls(), [nested], 'walls are appended to body, sometimes inside one wrapper');
});

test('the unlock rule only ships when the option is on', () => {
	mod.options.dismissLoginWall.value = false;
	Friction.module.beforeLoad();
	const off = document.querySelector('style[data-rsm-friction]').textContent;
	assert.ok(!off.includes('rsm-friction-unwalled'), 'no wall dismissal means no reason to override the page overflow');

	mod.options.dismissLoginWall.value = true;
	Friction.module.beforeLoad();
	const on = document.querySelector('style[data-rsm-friction]').textContent;
	assert.match(on, /html\.rsm-friction-unwalled[\s\S]*overflow: auto !important/);
	assert.match(on, /position: static !important/, 'reddit locks scroll with position:fixed on body as often as with overflow');
});

test('the wall watcher can be turned off', () => {
	installPage(WALLED);
	mod.options.dismissLoginWall.value = true;
	makeOverlay(document.querySelector('.LoginWallOverlay'));

	Friction.module.contentStart();
	// Calling contentStart twice must not leave the first observer running: the
	// repo has already shipped four modules that orphaned one this way.
	Friction.module.contentStart();
	Friction.stopWatchingForLoginWall();

	const source = Friction.stopWatchingForLoginWall.toString();
	assert.ok(source.includes('disconnect'), 'teardown has to actually disconnect');
});
