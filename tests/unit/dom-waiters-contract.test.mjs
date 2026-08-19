// What the DOM waiters do when the thing never arrives.
//
// They used to do nothing at all: no timeout, no rejection, and `disconnect()`
// on the success path only. A selector that never appeared left a promise
// pending for the life of the page and a MutationObserver attached to the
// subtree, firing on every mutation, for an outcome that would never come. On
// current Reddit, where the DOM streams continuously, that is a permanent cost.
// It is also why only two of 115 modules ever wrote to the module error log —
// there was nothing to write from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';
import { readRepoFile } from './helpers/loadFlowModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/' });

const dom = await loadModule('lib/utils/dom.js', 'dom-waiters');

// Nothing in the DOM reports how many observers are attached, and asserting that
// a settled promise does not settle again measures the wrong thing entirely —
// the `done` guard stops that whether or not anything was disconnected. Baiting
// it proved exactly that: removing the `disconnect()` call left this file green.
//
// So the global is swapped for a subclass that records which instances are still
// attached. jsdom's observers are real, and the bundle resolves
// `new MutationObserver` off the global at call time, so it gets these.
function trackObservers() {
	const Real = globalThis.MutationObserver;
	const live = new Set();
	class Tracked extends Real {
		observe(...args) {
			live.add(this);
			return super.observe(...args);
		}

		disconnect(...args) {
			live.delete(this);
			return super.disconnect(...args);
		}
	}
	globalThis.MutationObserver = Tracked;
	return { live, restore() { globalThis.MutationObserver = Real; } };
}

test('a descendant that never appears rejects rather than hanging', async () => {
	const host = document.createElement('div');
	document.body.append(host);

	await assert.rejects(
		dom.waitForDescendant(host, '.never-arrives', { timeout: 40, owner: 'exampleModule' }),
		/Timed out after 40ms waiting for a descendant matching \.never-arrives/,
	);
});

test('the timeout is reported once, naming who waited and what for', async () => {
	const reports = [];
	dom.setWaitTimeoutReporter(report => reports.push(report));

	const host = document.createElement('div');
	document.body.append(host);
	await assert.rejects(dom.waitForDescendant(host, '.absent', { timeout: 30, owner: 'exampleModule' }));

	assert.equal(reports.length, 1);
	assert.equal(reports[0].owner, 'exampleModule');
	assert.equal(reports[0].timeout, 30);
	assert.match(reports[0].describe, /\.absent/);

	dom.setWaitTimeoutReporter(() => {});
});

test('the observer is disconnected on timeout, on abort, and on success', async () => {
	const tracker = trackObservers();
	try {
		const host = document.createElement('div');
		document.body.append(host);

		await dom.waitForDescendant(host, '.absent-1', { timeout: 30 }).catch(() => {});
		assert.equal(tracker.live.size, 0, 'a timed-out waiter left its observer attached');

		const controller = new AbortController();
		const aborted = dom.waitForDescendant(host, '.absent-2', { signal: controller.signal, timeout: Infinity });
		assert.equal(tracker.live.size, 1, 'nothing was observing, so the next assertion proves nothing');
		controller.abort();
		await aborted.catch(() => {});
		assert.equal(tracker.live.size, 0, 'an aborted waiter left its observer attached');

		const found = dom.waitForDescendant(host, '.arrives', { timeout: 5000 });
		host.append(Object.assign(document.createElement('span'), { className: 'arrives' }));
		await found;
		assert.equal(tracker.live.size, 0, 'a resolved waiter left its observer attached');
	} finally {
		tracker.restore();
	}
});

test('an abort stops the waiter without reporting it as a defect', async () => {
	const reports = [];
	dom.setWaitTimeoutReporter(report => reports.push(report));

	const host = document.createElement('div');
	document.body.append(host);
	const controller = new AbortController();
	const waiting = dom.waitForDescendant(host, '.cancelled', { signal: controller.signal, timeout: Infinity });

	controller.abort();
	const error = await waiting.then(() => null, e => e);

	assert.ok(dom.isAbortError(error), `expected an abort error, got ${String(error)}`);
	// Deliberate cancellation is the caller saying it no longer cares. Logging it
	// would fill the error log with the `#siteTable` waiter losing its race on
	// every single current-Reddit page.
	assert.deepEqual(reports, []);
	dom.setWaitTimeoutReporter(() => {});
});

test('an already-aborted signal is refused before anything is observed', async () => {
	const host = document.createElement('div');
	document.body.append(host);
	const controller = new AbortController();
	controller.abort();

	const error = await dom.waitForDescendant(host, '.x', { signal: controller.signal }).then(() => null, e => e);
	assert.ok(dom.isAbortError(error));
});

test('an element already present resolves without observing anything', async () => {
	const host = document.createElement('div');
	host.innerHTML = '<span class="here"></span>';
	document.body.append(host);

	const found = await dom.waitForDescendant(host, '.here', { timeout: 30 });
	assert.equal(found.className, 'here');
});

test('selectors are tried in order, and the first match wins', async () => {
	const host = document.createElement('div');
	host.innerHTML = '<b class="second"></b>';
	document.body.append(host);

	// Neither present, then the fallback arrives: the ordered array is how a site
	// mid-rollout gets served. SponsorBlock carries the same shape and returns
	// null silently on a miss, which is how a breakage reads as a feature quietly
	// not running.
	assert.equal((await dom.waitForDescendant(host, ['.first', '.second'], { timeout: 30 })).tagName, 'B');

	host.innerHTML = '<i class="first"></i><b class="second"></b>';
	assert.equal((await dom.waitForDescendant(host, ['.first', '.second'], { timeout: 30 })).tagName, 'I');
});

test('waitForChild and waitForDescendantChange are bounded too', async () => {
	const host = document.createElement('div');
	document.body.append(host);

	await assert.rejects(dom.waitForChild(host, '.nope', { timeout: 30 }), /Timed out after 30ms/);
	await assert.rejects(dom.waitForDescendantChange(host, '.nope', { timeout: 30 }), /Timed out after 30ms/);
});

test('the observer tracking sees the waiters at all', async () => {
	// Without this, every `live.size === 0` above could be passing because the
	// tracker never saw a single observer.
	const tracker = trackObservers();
	try {
		const host = document.createElement('div');
		document.body.append(host);
		const waiting = dom.waitForDescendant(host, '.watched', { timeout: 5000 });
		assert.equal(tracker.live.size, 1, 'the waiter attached no observer the tracker could see');
		host.append(Object.assign(document.createElement('span'), { className: 'watched' }));
		await waiting;
	} finally {
		tracker.restore();
	}
});

test('the reporter is wired up, or none of this reaches the error log', () => {
	// The default reporter does nothing, which is precisely the shape of the four
	// unread mechanisms already found in this codebase. `lib/utils/` may not
	// import `lib/core/`, so the wiring lives on the other side of that boundary
	// and nothing but this asserts it exists.
	const init = readRepoFile('lib/core/init.js');
	assert.match(init, /setWaitTimeoutReporter\(/);
	assert.match(init, /recordModuleErrorOnce\(/);
	assert.match(init, /makeModuleErrorEntry\(/);

	const source = readRepoFile('lib/utils/dom.js');
	assert.doesNotMatch(source, /from '\.\.\/core\//, 'utils must not reach into core; install the reporter instead');
});

test('the waiters that hold observers for the life of the page are bounded by a signal', () => {
	// Two call sites deliberately pass `timeout: Infinity`, because a timeout
	// there would report a missing element on every page of one renderer. Both
	// watch a subtree that lives as long as the page, so both must carry a signal
	// or they are exactly the leak this change is about.
	//
	// `waitForChild` is exempt and stays that way: it observes `childList` on one
	// element, `bodyStart` uses it to wait for `<body>`, and a document that never
	// grows one has nothing here to cancel.
	for (const file of ['lib/utils/pagePhases.js', 'lib/utils/watchers.js']) {
		const source = readRepoFile(file);
		const unbounded = [...source.matchAll(/waitForDescendant(?:Change)?\([^)]*?\{([^}]*timeout: Infinity[^}]*)\}/g)];
		assert.ok(unbounded.length, `${file}: expected an unbounded subtree waiter to check`);
		for (const [, options] of unbounded) {
			assert.match(options, /signal:/, `${file}: an unbounded subtree waiter with no signal never lets go`);
		}
	}
});
