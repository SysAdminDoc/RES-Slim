// The first-run greeting appears exactly once, to someone with no context, and
// cannot be re-read. Two things therefore have to be right: when it fires, and
// that it never fires twice.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';
import { loadFlowModule, readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';

installDom();

const { shouldGreet, greetingText } = await loadFlowModule('lib/utils/firstRun.js', 'first-run');

test('a fresh install is greeted', () => {
	assert.equal(shouldGreet({ pendingGreeting: true }), true);
});

test('nobody else is', () => {
	// `chrome.storage.local` returns undefined for a key never set, and the flag is
	// cleared to `false` once used. Both must read as "do not greet".
	assert.equal(shouldGreet({ pendingGreeting: undefined }), false);
	assert.equal(shouldGreet({ pendingGreeting: false }), false);
	assert.equal(shouldGreet({ pendingGreeting: null }), false);
	// Strict, so a leftover value from some future change to what the background
	// writes does not read as a fresh install.
	assert.equal(shouldGreet({ pendingGreeting: 'true' }), false);
	assert.equal(shouldGreet({ pendingGreeting: 1 }), false);
});

test('the background only records an actual install, not an update', () => {
	// `onInstalled` fires with reason 'update' and 'chrome_update' too, on every
	// release, for every existing user.
	// In lib/environment/, not background.entry.js: that is where direct chrome.*
	// access belongs, and the nested eslintrc scoping the webextensions env is what
	// caught the first draft reaching outside it.
	const source = codeOnly(readRepoFile('lib/environment/background/firstRun.js'));
	assert.match(codeOnly(readRepoFile('lib/background.entry.js')), /background\/firstRun/, 'the entrypoint must still load it');
	assert.match(source, /onInstalled\.addListener/);
	assert.match(source, /reason !== 'install'/, 'an unfiltered listener greets every existing user on every update');
	assert.match(source, /RESmodules\.version\.pendingGreeting/, 'the flag the foreground reads');
});

test('the greeting says what is on and that nothing leaves the machine', () => {
	const text = greetingText(61);

	assert.match(text, /61/, 'the count is the one thing a new user cannot see for themselves');
	assert.ok(!/^RES-Slim/.test(text), 'the notification header already says RES-Slim');
	assert.match(text, /configurable/i, 'a list of things that turned themselves on needs a route to turning them off');
	assert.match(text, /nothing is sent anywhere/i, 'the privacy claim is the reason this fork exists');
	assert.ok(!/welcome/i.test(text), 'no greeting-card voice');
});

// --- the wiring ------------------------------------------------------------

const Version = await loadModule('lib/modules/version.js', 'first-run-version');
const version = Version.__registry.getUnchecked('version');

test('the greeting is wired into a stage that actually runs', () => {
	assert.equal(typeof version.afterLoad, 'function');

	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	assert.match(source, /greetOnFirstRun\(\)/, 'afterLoad must call it');
	assert.match(source, /Storage\.wrap\(/, 'the flag has to persist, or it fires once per page load');
});

test('the flag is written before the toast, not after', () => {
	// `afterLoad` runs in every tab. Two tabs opening together would both read
	// `false` and both greet if the write came after the notification. Ordering is
	// the whole mitigation, so it is asserted rather than assumed.
	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	const body = source.slice(source.indexOf('async function greetOnFirstRun'));

	// Slice past the early-return guard first. There are *two* `set(true)` calls —
	// the guard also records the flag for an existing user — and searching the whole
	// body finds that one, which always precedes the toast. The first version of
	// this assertion did exactly that and passed against the bug it exists to
	// catch, verified by moving the real write below `showNotification`.
	const guardEnd = body.indexOf('return;');
	assert.ok(guardEnd > 0, 'the early-return guard must still be there, or this slice is wrong');
	const greetPath = body.slice(guardEnd);

	const setIndex = greetPath.indexOf('pendingGreetingStorage.set(false)');
	const notifyIndex = greetPath.indexOf('showNotification');

	assert.ok(setIndex > 0, 'the greet path must record the flag');
	assert.ok(notifyIndex > 0, 'the greet path must show the toast');
	assert.ok(setIndex < notifyIndex, 'the flag must be set before the toast is shown');
});

test('the settings link is inserted as markup, not escaped into visible angle brackets', () => {
	// `makeUrlHashLink` returns a markup string; every other caller wraps it in
	// `string.safe()`. Interpolating it directly renders the anchor as text.
	const source = codeOnly(readRepoFile('lib/modules/version.js'));
	assert.match(source, /string\.safe\(SettingsNavigation\.makeUrlHashLink/);
});
