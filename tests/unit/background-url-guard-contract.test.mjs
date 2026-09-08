import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-url-guard');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(read('lib/environment/background/urlGuard.js'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'urlGuard.mjs');
fs.writeFileSync(modulePath, stripped);
const { isProxyableUrl, isOpenableTabUrl, isInjectableScript, injectableScripts } = await import(pathToFileURL(modulePath).href);

// The tabs handler is executed rather than read, so `loadFlowModule` does the
// stripping for that one.
const { loadFlowModule } = await import('./helpers/loadFlowModule.mjs');

test('isProxyableUrl allows absolute http(s) only', () => {
	assert.equal(isProxyableUrl('https://api.pullpush.io/x'), true);
	assert.equal(isProxyableUrl('http://127.0.0.1:7860/ytdlp'), true);
	assert.equal(isProxyableUrl('https://i.redd.it/a.jpg'), true);
});

test('isProxyableUrl rejects non-http(s) schemes and junk', () => {
	assert.equal(isProxyableUrl('file:///etc/passwd'), false);
	assert.equal(isProxyableUrl('data:text/html,<script>'), false);
	assert.equal(isProxyableUrl('blob:https://x/abc'), false);
	assert.equal(isProxyableUrl('javascript:alert(1)'), false);
	assert.equal(isProxyableUrl('chrome-extension://abc/x'), false);
	assert.equal(isProxyableUrl('/relative/path'), false);
	assert.equal(isProxyableUrl(''), false);
	assert.equal(isProxyableUrl(null), false);
});

test('every background proxy that takes a URL gates on one', () => {
	// Four handlers take something URL-shaped from a content script and act on it.
	// Two of them checked. The header of `urlGuard.js` names the threat -- a
	// content-script XSS using the background as a confused deputy -- and it
	// applies to all four or to none.
	const gated = {
		'lib/environment/background/ajax.js': /if \(!isProxyableUrl\(url\)\)/,
		'lib/environment/background/download.js': /if \(!isProxyableUrl\(url\)\)/,
		'lib/environment/background/tabs.js': /if \(!isOpenableTabUrl\(url\)\) return;/,
		'lib/environment/background/loadScript.js': /if \(!isInjectableScript\(url\)\) throw/,
	};
	for (const [file, pattern] of Object.entries(gated)) {
		assert.match(read(file), pattern, `${file} acts on a URL from a content script without checking it`);
	}

	// And every background file that registers a handler is accounted for, so a
	// fifth one that takes a URL cannot be added without someone deciding which
	// of these two lists it belongs in. Textual detection of "takes a URL from
	// the caller" is not reliable enough to be the gate -- `permissions.js`
	// builds its own -- so the decision is written down instead.
	const takesNoCallerUrl = {
		'featureDb.js': 'store ids and records',
		'firstRun.js': 'nothing',
		'i18n.js': 'message keys',
		'localePersistor.js': 'a locale name',
		'messaging.js': 'the bridge itself',
		'multicast.js': 'a message to rebroadcast',
		'oldRedditRedirect.js': 'a boolean; the rules are built here',
		'pageAction.js': 'a state flag',
		'permissions.js': 'permission and origin names; the prompt URL is built from location.origin',
		'session.js': 'session keys and values',
		'shredLease.js': 'an account and a lease token',
		'storage.js': 'storage keys and values',
		'xhrCache.js': 'cache keys',
	};
	const registered = fs.readdirSync(path.join(repoRoot, 'lib/environment/background'))
		.filter(name => name.endsWith('.js'))
		.filter(name => /addListener\(/.test(read(`lib/environment/background/${name}`)));
	const accounted = new Set([
		...Object.keys(gated).map(file => file.split('/').pop()),
		...Object.keys(takesNoCallerUrl),
	]);
	const unaccounted = registered.filter(name => !accounted.has(name));
	assert.deepEqual(unaccounted, [], `a background handler is in neither list: ${unaccounted.join(', ')}`);
});

test('openNewTabs refuses what it should not open', async () => {
	// `file:///` is the one the browser does not refuse on its own, and it reads
	// the local disk into a tab.
	const opened = [];
	globalThis.chrome = {
		tabs: { create: options => { opened.push(options.url); } },
		runtime: { lastError: undefined },
	};
	globalThis.__guardListeners = {};

	// `isOpenableTabUrl` asks the browser what this extension's own origin is, so
	// the stub has to answer -- and has to answer with an id that is not the one
	// the refused row uses.
	globalThis.chrome.runtime = { ...globalThis.chrome.runtime, getURL: path => `chrome-extension://res-slim-test/${path}` };

	await loadFlowModule('lib/environment/background/tabs.js', `tabs-guard-${Math.random().toString(36).slice(2)}`, {
		deps: ['lib/environment/background/urlGuard.js'],
		stubs: { './messaging': 'export function addListener(type, cb) { globalThis.__guardListeners[type] = cb; }\n' },
	});
	const openNewTabs = globalThis.__guardListeners.openNewTabs;
	assert.ok(openNewTabs, 'the handler was never registered');

	openNewTabs({
		urls: [
			'file:///etc/passwd',
			'https://old.reddit.com/r/pics',
			// eslint-disable-next-line no-script-url
			'javascript:alert(1)',
			// Another extension's page is not ours to open.
			'chrome-extension://someone-else/options.html',
			'data:text/html,<script>',
			'http://example.com/',
			// This extension's own settings console. Refusing it took away the
			// recovery path from a reader whose embedded console had already failed
			// to load, which is the only time that code runs.
			'chrome-extension://res-slim-test/options.html#!settings/showImages',
			null,
			'',
		],
		focusIndex: 1,
	}, { tab: { index: 0, id: 7, cookieStoreId: 'x' } });

	assert.deepEqual(opened, [
		'https://old.reddit.com/r/pics',
		'http://example.com/',
		'chrome-extension://res-slim-test/options.html#!settings/showImages',
	]);

	// And a payload that is not a list at all does not throw out of the handler,
	// nor open anything.
	const before = [...opened];
	assert.doesNotThrow(() => openNewTabs({ urls: 'https://example.com/', focusIndex: 0 }, { tab: { index: 0, id: 7 } }));
	assert.deepEqual(opened, before);
});

test('loadScript injects only the three bundles that are asked for', () => {
	// `files` resolves inside the package, so this cannot reach the web. What it
	// can do, handed a name from a content-script XSS, is put one of this
	// extension's own bundles into the frame that asked.
	for (const allowed of injectableScripts()) assert.equal(isInjectableScript(allowed), true, allowed);

	for (const refused of [
		'/foreground.entry.js',
		'/background.entry.js',
		'/options.entry.js',
		'jszip.min.js',
		'/jszip.min.js?x',
		'../jszip.min.js',
		'https://evil.example/x.js',
		'',
		null,
		undefined,
		42,
	]) {
		assert.equal(isInjectableScript(refused), false, `${String(refused)} was allowed`);
	}

	// The list is what the callers actually ask for -- no more, and no fewer.
	const callers = new Set();
	for (const file of ['lib/modules/galleryZip.js', 'lib/modules/showImages/mediaTypes.js', 'lib/utils/snudown.js']) {
		for (const match of read(file).matchAll(/loadScript\('([^']+)'\)/g)) callers.add(match[1]);
	}
	assert.deepEqual([...callers].sort(), injectableScripts().sort());
});

test('a tab may be opened at this extension, and at no other', () => {
	// The scheme check is right for the fetch proxies and wrong for a tab: the
	// settings console's own recovery path opens `options.html` in one.
	globalThis.chrome = {
		...globalThis.chrome,
		runtime: { getURL: path => `chrome-extension://res-slim-test/${path}` },
	};

	assert.equal(isOpenableTabUrl('chrome-extension://res-slim-test/options.html'), true);
	assert.equal(isOpenableTabUrl('chrome-extension://res-slim-test/options.html#!settings/showImages'), true);
	assert.equal(isOpenableTabUrl('moz-extension://res-slim-test/options.html'), false, 'a different scheme is a different origin');
	assert.equal(isOpenableTabUrl('chrome-extension://someone-else/options.html'), false, 'another extension page was openable');
	assert.equal(isOpenableTabUrl('https://old.reddit.com/'), true);
	assert.equal(isOpenableTabUrl('file:///etc/passwd'), false);
	assert.equal(isOpenableTabUrl(null), false);
});
