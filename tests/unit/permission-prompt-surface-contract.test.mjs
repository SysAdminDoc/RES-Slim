import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

// Firefox rejects `permissions.request()` when the calling document is in an
// extension popup window (Mozilla Bug 1957822, still open; upstream RES issue
// 5530 is the same failure reported by a user). The prompt this repo ships used
// exactly that topology on every browser, so on Firefox it showed a window that
// could not do the one thing it existed for.
//
// These execute the background module against a fake `chrome` rather than
// regexing it, because "which API was called" is the whole defect and a source
// match cannot tell you a code path ran.

const REAL_TARGET = process.env.BUILD_TARGET;

// `apiToPromise` is reimplemented rather than imported so the stub does not need
// the extension's own `chrome.runtime.lastError` plumbing; the real one is
// covered by every module that uses it.
const API_STUB = `
export function apiToPromise(func) {
	return (...args) => new Promise((resolve, reject) => {
		func(...args, (...results) => {
			if (globalThis.chrome.runtime.lastError) reject(new Error(globalThis.chrome.runtime.lastError.message));
			else resolve(results.length > 1 ? results : results[0]);
		});
	});
}
`;

const MESSAGING_STUB = `
export const listeners = new Map();
export function addListener(type, callback) { listeners.set(type, callback); }
`;

function fakeChrome() {
	const calls = { windows: [], tabs: [], removed: [], requested: [] };
	const updated = [];
	const removedListeners = [];

	globalThis.chrome = {
		runtime: { lastError: null },
		permissions: {
			// The background has no user gesture, so the direct request always
			// rejects here — which is what routes every browser into the prompt.
			contains: (details, cb) => cb(true),
			request: (details, cb) => { calls.requested.push(details); globalThis.chrome.runtime.lastError = { message: 'no user gesture' }; cb(false); globalThis.chrome.runtime.lastError = null; },
		},
		windows: {
			getCurrent: cb => cb({ width: 1000, height: 800 }),
			create: (details, cb) => { calls.windows.push(details); cb({ tabs: [{ id: 11 }] }); },
		},
		tabs: {
			create: (details, cb) => { calls.tabs.push(details); cb({ id: 22 }); },
			remove: (tabId, cb) => { calls.removed.push(tabId); cb(); },
			onUpdated: { addListener: fn => updated.push(fn), removeListener: fn => { const i = updated.indexOf(fn); if (i >= 0) updated.splice(i, 1); } },
			onRemoved: { addListener: fn => removedListeners.push(fn), removeListener: fn => { const i = removedListeners.indexOf(fn); if (i >= 0) removedListeners.splice(i, 1); } },
		},
	};
	globalThis.location = { origin: 'chrome-extension://res-slim-test' };

	return {
		calls,
		// Standing in for the prompt page navigating to itself with a result.
		reportResult(tabId, result) {
			for (const fn of [...updated]) fn(tabId, { url: `chrome-extension://res-slim-test/prompt.html?result=${result}` });
		},
		closeTab(tabId) {
			for (const fn of [...removedListeners]) fn(tabId);
		},
		get watching() {
			return { updated: updated.length, removed: removedListeners.length };
		},
	};
}


// A prompt that never settles is a real failure mode of this code, and awaiting
// one directly hangs the whole file with no subtest to point at. Bounded, with
// an unref'd timer so a stray one cannot hold the process open.
function settled(promise, what) {
	return Promise.race([
		promise,
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`${what} never settled`)), 2000);
			if (typeof timer.unref === 'function') timer.unref();
		}),
	]);
}

function loadPermissions(target) {
	process.env.BUILD_TARGET = target;
	// A distinct temp directory per target: the module reads `process.env` at call
	// time, but the import cache is keyed by path, so sharing one would hand the
	// second test the first one's module instance.
	return loadFlowModule('lib/environment/background/permissions.js', `permission-prompt-${target}`, {
		stubs: { '../utils/api': API_STUB, './messaging': MESSAGING_STUB },
	});
}

test.after(() => {
	if (REAL_TARGET === undefined) delete process.env.BUILD_TARGET;
	else process.env.BUILD_TARGET = REAL_TARGET;
});

test('the Firefox build asks in a normal tab, never an extension popup window', async () => {
	const browser = fakeChrome();
	const { handleMessage } = await loadPermissions('firefox');

	const pending = handleMessage({ operation: 'request', permissions: ['downloads'], origins: [] });
	// Let the rejected direct request fall through to the prompt.
	await new Promise(resolve => { setTimeout(resolve, 0); });

	assert.deepEqual(browser.calls.windows, [], 'a popup window is the topology Firefox refuses to raise its panel from');
	assert.equal(browser.calls.tabs.length, 1, 'the prompt has to be a normal browsing context');
	assert.equal(browser.calls.tabs[0].active, true, 'a background tab cannot receive the user gesture the request needs');
	assert.match(browser.calls.tabs[0].url, /prompt\.html\?/);

	browser.reportResult(22, 'true');
	assert.equal(await settled(pending, 'the prompt'), true);
});

test('the Chrome build keeps its centred popup window', async () => {
	const browser = fakeChrome();
	const { handleMessage } = await loadPermissions('chrome');

	const pending = handleMessage({ operation: 'request', permissions: ['downloads'], origins: [] });
	await new Promise(resolve => { setTimeout(resolve, 0); });

	assert.equal(browser.calls.tabs.length, 0, 'Chrome has no reason to take over a tab');
	assert.equal(browser.calls.windows.length, 1);
	assert.equal(browser.calls.windows[0].type, 'popup');
	// Centred on the 1000x800 window the fake reports.
	assert.equal(browser.calls.windows[0].left, Math.floor(1000 / 2 - 640 / 2));
	assert.equal(browser.calls.windows[0].top, Math.floor(800 / 2 - 560 / 2));

	browser.reportResult(11, 'true');
	assert.equal(await settled(pending, 'the prompt'), true);
});

test('a grant closes exactly the prompt surface, once, and stops listening', async () => {
	const browser = fakeChrome();
	const { handleMessage } = await loadPermissions('firefox');

	const pending = handleMessage({ operation: 'request', permissions: [], origins: ['https://example.com/*'] });
	await new Promise(resolve => { setTimeout(resolve, 0); });
	assert.deepEqual(browser.watching, { updated: 1, removed: 1 });

	// A result for some other tab is not this prompt's answer.
	browser.reportResult(999, 'true');
	browser.reportResult(22, 'true');

	assert.equal(await settled(pending, 'the prompt'), true);
	assert.deepEqual(browser.calls.removed, [22], 'exactly the prompt tab, and only it');
	assert.deepEqual(browser.watching, { updated: 0, removed: 0 }, 'a settled prompt must not keep listening');

	// A late second result cannot produce a second close or a second answer.
	browser.reportResult(22, 'false');
	assert.deepEqual(browser.calls.removed, [22]);
});

test('a denial and a closed tab each settle as one false', async () => {
	const denied = fakeChrome();
	const { handleMessage } = await loadPermissions('firefox');

	const refused = handleMessage({ operation: 'request', permissions: ['downloads'], origins: [] });
	await new Promise(resolve => { setTimeout(resolve, 0); });
	denied.reportResult(22, 'false');
	assert.equal(await settled(refused, 'the denial'), false);
	assert.deepEqual(denied.calls.removed, [22]);

	const abandoned = fakeChrome();
	const dismissed = handleMessage({ operation: 'request', permissions: ['downloads'], origins: [] });
	await new Promise(resolve => { setTimeout(resolve, 0); });
	abandoned.closeTab(22);
	assert.equal(await settled(dismissed, 'the dismissal'), false, 'closing the prompt is a denial, not a hang');
	assert.deepEqual(abandoned.calls.removed, [], 'a tab that is already gone must not be removed again');
});

test('a malformed result is a denial rather than a hang', async () => {
	const browser = fakeChrome();
	const { handleMessage } = await loadPermissions('firefox');

	const pending = handleMessage({ operation: 'request', permissions: ['downloads'], origins: [] });
	await new Promise(resolve => { setTimeout(resolve, 0); });
	browser.reportResult(22, 'not-json');
	assert.equal(await settled(pending, 'the prompt'), false);
});

test('the prompt page awaits the request and reports the resolved answer', () => {
	// The two mistakes in upstream PR 5565. An un-awaited `permissions.request`
	// reports a Promise, which is truthy, so every prompt reads as granted; and
	// reading the wrong property reports `undefined`, so every prompt reads as
	// denied. Both are silent — the prompt closes and the caller believes it.
	const source = readRepoFile('lib/environment/background/permissions/prompt.entry.js');

	assert.match(source, /const granted = await chrome\.permissions\.request\(/, 'the request has to be awaited before it is read');
	assert.match(source, /finishPrompt\(Boolean\(granted\)\)/, 'the resolved answer is what the opener is told, coerced once');
	assert.ok(
		!/finishPrompt\(chrome\.permissions\.request\(/.test(source),
		'a Promise handed to finishPrompt is truthy, which grants everything',
	);
	// The request must carry both halves. Sending one and reading the other is
	// how a prompt asks for nothing and reports success.
	assert.match(source, /chrome\.permissions\.request\(\{ permissions, origins \}\)/);
});
