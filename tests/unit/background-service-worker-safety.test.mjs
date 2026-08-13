// The background bundle must evaluate inside an MV3 service worker.
//
// This contract used to grep one file — `lib/core/migrate/migrate.js` — for
// `document.` and `window.`. The background graph pulls in several hundred
// modules, so that assertion covered a fraction of a percent of the code that
// actually has to run in a worker, and it could not catch a DOM dependency
// arriving through any other import.
//
// A service worker with no `document` and no `window` either evaluates the bundle
// or it does not. That is a binary the test can reproduce exactly: bundle the
// real entrypoint the way build.js does, then run it in a context shaped like a
// worker global. A failure here is the extension being dead on install, which is
// about as severe as this codebase gets.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { bundleEntry } from './helpers/loadModule.mjs';
import { codeOnly, readRepoFile } from './helpers/loadFlowModule.mjs';

const bundle = await bundleEntry('lib/background.entry.js', 'service-worker');

const noop = () => {};
const listeners = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });

// Everything a real MV3 service worker global exposes, and nothing it does not.
// `document` and `window` are deliberately absent — that absence is the test.
function workerGlobal() {
	const scope = {
		chrome: {
			declarativeNetRequest: {
				updateDynamicRules: (rules, cb) => cb && cb(),
				getDynamicRules: cb => cb && cb([]),
			},
			runtime: {
				id: 'res-slim-test',
				getURL: p => `chrome-extension://res-slim-test/${p}`,
				getManifest: () => ({ version: '0.0.0-test' }),
				onMessage: listeners(),
				onInstalled: listeners(),
				onStartup: listeners(),
				onConnect: listeners(),
				sendMessage: noop,
				lastError: undefined,
			},
			storage: {
				local: { get: (k, cb) => cb && cb({}), set: (i, cb) => cb && cb(), remove: (k, cb) => cb && cb(), clear: cb => cb && cb() },
				onChanged: listeners(),
			},
			tabs: { create: noop, query: (q, cb) => cb && cb([]), sendMessage: noop, onUpdated: listeners(), onRemoved: listeners(), onActivated: listeners() },
			downloads: { download: noop },
			permissions: { request: noop, contains: noop, getAll: noop, onAdded: listeners(), onRemoved: listeners() },
			action: { onClicked: listeners(), setIcon: noop, setTitle: noop, show: noop, hide: noop },
			pageAction: { onClicked: listeners(), show: noop, hide: noop },
			webNavigation: { onHistoryStateUpdated: listeners(), onCommitted: listeners() },
			i18n: { getMessage: k => k, getUILanguage: () => 'en' },
			extension: { inIncognitoContext: false },
			scripting: { executeScript: noop, registerContentScripts: noop, getRegisteredContentScripts: noop },
			windows: { create: noop, update: noop, onRemoved: listeners() },
			contextMenus: { create: noop, onClicked: listeners(), removeAll: noop },
			alarms: { create: noop, onAlarm: listeners(), clear: noop },
		},
		// WorkerNavigator: present in a service worker, unlike document/window.
		navigator: { language: 'en-US', languages: ['en-US'], userAgent: 'service-worker' },
		location: { href: 'chrome-extension://res-slim-test/background.entry.js', origin: 'chrome-extension://res-slim-test' },
		console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
		fetch: () => Promise.resolve({ ok: true, status: 200, headers: new Map(), text: () => Promise.resolve('') }),
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		queueMicrotask,
		addEventListener: noop,
		removeEventListener: noop,
		importScripts: noop,
		skipWaiting: noop,
		caches: { open: () => Promise.resolve({}) },
		clients: { matchAll: () => Promise.resolve([]) },
		indexedDB: { open: () => ({}) },
		crypto: { getRandomValues: a => a, randomUUID: () => 'res-slim-test' },
		atob: s => Buffer.from(s, 'base64').toString('binary'),
		btoa: s => Buffer.from(s, 'binary').toString('base64'),
		performance: { now: () => 0 },
		URL,
		URLSearchParams,
		TextEncoder,
		TextDecoder,
		Response: class {},
		Request: class {},
		Headers: class {},
		Blob: class {},
		FileReader: class {},
	};

	scope.self = scope;
	scope.globalThis = scope;
	return scope;
}

test('the background bundle evaluates with no document and no window', () => {
	const scope = workerGlobal();
	assert.equal('document' in scope, false, 'sanity: the sandbox must not provide a document');
	assert.equal('window' in scope, false, 'sanity: the sandbox must not provide a window');

	vm.createContext(scope);
	assert.doesNotThrow(
		() => vm.runInContext(bundle, scope, { filename: 'background.entry.js' }),
		'the background bundle must run in an MV3 service worker — a throw here is the extension dead on install',
	);
});

// The sandbox has to be able to fail, or the test above proves nothing.
test('the worker sandbox genuinely lacks the DOM', () => {
	const scope = workerGlobal();
	vm.createContext(scope);

	assert.throws(() => vm.runInContext('document.body', scope), /document is not defined/);
	assert.throws(() => vm.runInContext('window.location', scope), /window is not defined/);
});

test('the background entrypoint registers its message listeners on evaluation', () => {
	// Evaluating without throwing is necessary but not sufficient: a bundle that
	// silently no-ops would also pass. The worker's whole job is to be listening.
	const captured = [];
	const scope = workerGlobal();
	scope.chrome.runtime.onMessage = {
		addListener: fn => { captured.push(fn); },
		removeListener: noop,
		hasListener: () => false,
	};

	vm.createContext(scope);
	vm.runInContext(bundle, scope, { filename: 'background.entry.js' });

	assert.ok(captured.length > 0, 'the background must register at least one runtime.onMessage listener');
});

// Kept from the original contract, because it is cheap and names the specific
// file that motivated it — but it is now the belt, not the braces.
test('migrations do not reach for DOM globals', () => {
	const source = codeOnly(readRepoFile('lib/core/migrate/migrate.js'));

	assert.doesNotMatch(source, /\bdocument\./, 'Chrome MV3 service workers do not expose document');
	assert.doesNotMatch(source, /\bwindow\./, 'Chrome MV3 service workers do not expose window');
});
