// settingsNavigation, executed rather than regexed.
//
// This module was one of the 33 with no test at all, despite being
// `alwaysEnabled` and owning every route into the settings console. The v0.3.8
// notes in CLAUDE.md list five bugs fixed here by hand; each one is pinned below,
// so a regression fails rather than being rediscovered by reading the source.
//
// Runs through tests/unit/helpers/loadModule.mjs, which bundles the real module
// with the real `lib/environment` over a stubbed `chrome`. Nothing here asserts
// on source text.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';

const SettingsNavigation = await loadModule('lib/modules/settingsNavigation.js', 'settings-navigation');

test('the module is registered and always enabled', () => {
	assert.equal(SettingsNavigation.module.moduleID, 'settingsNavigation');
	assert.equal(SettingsNavigation.module.alwaysEnabled, true, 'every route into the console depends on this module running');
});

test('parseHash round-trips with makeUrlHash', () => {
	for (const [moduleID, optionKey] of [['commentTools', 'userAutocomplete'], ['nightMode', undefined], [undefined, undefined]]) {
		const hash = SettingsNavigation.makeUrlHash(moduleID, optionKey);
		const parsed = SettingsNavigation.parseHash(hash);
		assert.equal(parsed.moduleID, moduleID, `moduleID should survive ${hash}`);
		assert.equal(parsed.optionKey, optionKey, `optionKey should survive ${hash}`);
	}
});

// v0.3.8: the old parser used a hand-rolled regex with a literal `%20` replace,
// so anything else needing encoding was mangled one way or the other.
test('special characters survive the hash round trip', () => {
	const optionKey = 'a key/with slashes & spaces';
	const hash = SettingsNavigation.makeUrlHash('someModule', optionKey);

	assert.ok(!hash.includes(' '), 'a raw space in a URL hash is not safe to emit');
	assert.equal(SettingsNavigation.parseHash(hash).optionKey, optionKey);
});

// v0.3.8: the prefix test was a bare substring match, so an unrelated route that
// merely *started* with the settings prefix parsed as a module named after the
// rest of the route.
test('a longer hash that merely starts with the settings prefix is not a settings route', () => {
	const decoy = '#res:settings-redirect-standalone-options-page/accountSwitcher';
	const parsed = SettingsNavigation.parseHash(decoy);

	assert.notEqual(
		parsed && parsed.moduleID,
		'-redirect-standalone-options-page',
		'the prefix must be followed by "/" or end-of-string, not matched as a substring',
	);
	assert.equal(SettingsNavigation.isSettingsUrl(`https://old.reddit.com/${decoy}`), false);
});

test('isSettingsUrl recognises settings routes and rejects ordinary reddit URLs', () => {
	assert.equal(SettingsNavigation.isSettingsUrl('https://old.reddit.com/#res:settings'), true);
	assert.equal(SettingsNavigation.isSettingsUrl('https://old.reddit.com/#res:settings/nightMode'), true);

	assert.equal(SettingsNavigation.isSettingsUrl('https://old.reddit.com/r/pics'), false);
	assert.equal(SettingsNavigation.isSettingsUrl('https://old.reddit.com/#comments'), false);
	// A hash that merely contains the marker later on is not a settings route.
	assert.equal(SettingsNavigation.isSettingsUrl('https://old.reddit.com/#not-res:settings'), false);
});

// v0.3.8: `makeUrlHashLink` builds markup that is inserted into reddit's own
// pages, so an unescaped option key or display text would be an injection point.
test('makeUrlHashLink escapes the values it interpolates', () => {
	const link = SettingsNavigation.makeUrlHashLink('mod', 'opt', '<img src=x onerror=alert(1)>', 'cls');

	assert.ok(!link.includes('<img'), `display text must not survive as markup: ${link}`);
	assert.ok(link.includes('cls'), 'the css class should still be applied');
});

test('makeUrlHashLink falls back to a readable label rather than emitting an empty anchor', () => {
	const link = SettingsNavigation.makeUrlHashLink('nightMode');
	const text = link.replace(/<[^>]*>/g, '').trim();

	assert.notEqual(text, '', 'a link with no display text would be invisible and unclickable');
});

test('opening and closing the console leaves no listeners behind', () => {
	// The fallback that reopens the console in a tab when the frame does not
	// progress used to register its listener inside the iframe's `load` handler.
	// That handler fires on every navigation *inside* the frame, so each one left
	// another anonymous `message` listener on the page's window, holding its
	// closure for the life of the document - and on current Reddit the document
	// is the whole session.
	const listeners = new Set();
	const originalAdd = window.addEventListener.bind(window);
	const originalRemove = window.removeEventListener.bind(window);
	window.addEventListener = (type, handler, options) => {
		if (type === 'message') listeners.add(handler);
		return originalAdd(type, handler, options);
	};
	window.removeEventListener = (type, handler, options) => {
		if (type === 'message') listeners.delete(handler);
		return originalRemove(type, handler, options);
	};

	try {
		for (const pass of [1, 2, 3]) {
			SettingsNavigation.open('hover');
			// Every navigation inside the frame runs the load handler again.
			const frame = document.getElementById('console-container');
			assert.ok(frame, `pass ${pass}: the console frame should be in the document while it is open`);
			// jsdom's about:blank frame refuses a targeted postMessage, and the load
			// handler does that first: without this the handler throws before
			// reaching anything worth measuring, and the test passes for the wrong
			// reason whatever the code does.
			if (frame.contentWindow) frame.contentWindow.postMessage = () => {};
			for (const load of [1, 2, 3]) frame.dispatchEvent(new window.Event('load', { detail: load }));
			SettingsNavigation.close();
		}
		assert.deepEqual([...listeners], [], `${listeners.size} message listener(s) outlived the console`);
	} finally {
		window.addEventListener = originalAdd;
		window.removeEventListener = originalRemove;
	}
});
