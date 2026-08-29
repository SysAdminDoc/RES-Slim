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

// --- the three that were not bounded at all -----------------------------------
//
// `waitForAttach`, `waitForDetach` and `waitForSelectorMatch` each built their
// own promise with a `disconnect()` on the success path only, and took a
// `cancel` promise that could only ever resolve. `waitForSelectorMatch` is the
// one that cost something every day: its only caller runs per link post, and a
// post nobody expands never matches, so an attribute observer stayed attached
// and an async frame stayed pending for every one of them.

function element(tag = 'div') {
	const el = document.createElement(tag);
	document.body.append(el);
	return el;
}

test('waitForSelectorMatch resolves, and lets go of its observer when it does', async () => {
	const tracking = trackObservers();
	try {
		const el = element();
		el.className = 'expando-uninitialized';
		const waiting = dom.waitForSelectorMatch(el, ':not(.expando-uninitialized)', { timeout: Infinity });
		assert.equal(tracking.live.size, 1, 'it has to be observing something to be waiting');

		el.className = '';
		await waiting;
		assert.equal(tracking.live.size, 0, 'a resolved wait must not keep observing');
	} finally {
		tracking.restore();
	}
});

test('waitForSelectorMatch is released by its signal, which is the whole point', async () => {
	// Unbounded by design: the reader may expand the post in an hour, or never.
	// Without a signal that is one observer and one pending frame per link post,
	// for the life of the page, accumulating across an infinite scroll.
	const tracking = trackObservers();
	try {
		const el = element();
		el.className = 'expando-uninitialized';
		const controller = new AbortController();
		const waiting = dom.waitForSelectorMatch(el, ':not(.expando-uninitialized)', { signal: controller.signal, timeout: Infinity });
		assert.equal(tracking.live.size, 1);

		controller.abort();
		await assert.rejects(waiting, e => dom.isAbortError(e));
		assert.equal(tracking.live.size, 0, 'an aborted wait must disconnect');
	} finally {
		tracking.restore();
	}
});

test('waitForSelectorMatch answers immediately without observing anything', async () => {
	const tracking = trackObservers();
	try {
		const el = element();
		await dom.waitForSelectorMatch(el, 'div');
		assert.equal(tracking.live.size, 0, 'an element that already matches needs no observer');
	} finally {
		tracking.restore();
	}
});

test('waitForAttach and waitForDetach disconnect on success, timeout and abort', async () => {
	const tracking = trackObservers();
	try {
		const parent = element();
		const child = document.createElement('span');

		const attaching = dom.waitForAttach(parent, child, { timeout: Infinity });
		assert.equal(tracking.live.size, 1);
		parent.append(child);
		await attaching;
		assert.equal(tracking.live.size, 0, 'a resolved attach must disconnect');

		// Detach resolves when the element leaves the document.
		const detaching = dom.waitForDetach(child);
		assert.equal(tracking.live.size, 1);
		child.remove();
		await detaching;
		assert.equal(tracking.live.size, 0, 'a resolved detach must disconnect');

		// A bounded attach that never happens rejects and disconnects.
		const orphan = document.createElement('span');
		await assert.rejects(dom.waitForAttach(parent, orphan, { timeout: 20 }), /Timed out/);
		assert.equal(tracking.live.size, 0, 'a timed-out attach must disconnect');

		// And an abort releases the unbounded detach.
		const staying = element();
		const controller = new AbortController();
		const never = dom.waitForDetach(staying, { signal: controller.signal });
		assert.equal(tracking.live.size, 1);
		controller.abort();
		await assert.rejects(never, e => dom.isAbortError(e));
		assert.equal(tracking.live.size, 0, 'an aborted detach must disconnect');
	} finally {
		tracking.restore();
	}
});

test('waitForEvent removes every listener it installed, not just the winner', async () => {
	// One promise per event, each removing only its own listener, left the losing
	// listener attached for as long as the element lived. `mediaTypes.js` alone
	// has three multi-event waits.
	const el = element();
	const installed = new Map();
	const realAdd = el.addEventListener.bind(el);
	const realRemove = el.removeEventListener.bind(el);
	el.addEventListener = (type, fn, opts) => { installed.set(type, (installed.get(type) || 0) + 1); realAdd(type, fn, opts); };
	el.removeEventListener = (type, fn, opts) => { installed.set(type, (installed.get(type) || 0) - 1); realRemove(type, fn, opts); };

	const waiting = dom.waitForEvent(el, 'load', 'error');
	assert.deepEqual([...installed.entries()].sort(), [['error', 1], ['load', 1]], 'both events have to be listened for');

	el.dispatchEvent(new window.Event('load'));
	const settled = await waiting;
	assert.equal(settled.type, 'load', 'the first event to arrive is the answer');
	assert.deepEqual([...installed.entries()].sort(), [['error', 0], ['load', 0]], 'the losing listener must come off too');

	// A second event after the race is over cannot settle it again or re-fire.
	el.dispatchEvent(new window.Event('error'));
	assert.deepEqual([...installed.entries()].sort(), [['error', 0], ['load', 0]]);
});

test('waitForEvent can be bounded and aborted, and lets go of its listeners either way', async () => {
	// Asserting only that the promise rejects would leave a dropped `disconnect()`
	// on the timeout and abort paths invisible, which is the same shape as the
	// leak this whole change is about.
	const counted = () => {
		const el = element();
		const live = new Map();
		const add = el.addEventListener.bind(el);
		const remove = el.removeEventListener.bind(el);
		el.addEventListener = (type, fn, opts) => { live.set(type, (live.get(type) || 0) + 1); add(type, fn, opts); };
		el.removeEventListener = (type, fn, opts) => { live.set(type, (live.get(type) || 0) - 1); remove(type, fn, opts); };
		return { el, live };
	};

	const timedOut = counted();
	await assert.rejects(dom.waitForEventWith(timedOut.el, ['click', 'keydown'], { timeout: 20 }), /Timed out/);
	assert.deepEqual([...timedOut.live.values()], [0, 0], 'a timed-out wait must remove every listener it installed');

	const aborted = counted();
	const controller = new AbortController();
	const waiting = dom.waitForEventWith(aborted.el, ['click', 'keydown'], { signal: controller.signal, timeout: Infinity });
	assert.deepEqual([...aborted.live.values()], [1, 1]);
	controller.abort();
	await assert.rejects(waiting, e => dom.isAbortError(e));
	assert.deepEqual([...aborted.live.values()], [0, 0], 'an aborted wait must remove every listener it installed');
});

test('core installs the page signal the open-ended waiters hang off', () => {
	// `lib/utils/` may not import `lib/core/`, so the signal arrives the same way
	// the timeout reporter does. A waiter that asks for it before core starts gets
	// null, which is the unbounded behaviour it had anyway.
	const init = readRepoFile('lib/core/init.js');
	assert.match(init, /setPageSignal\(pageSignal\)/, 'the signal has to actually be installed');
	assert.match(init, /pagehide/, 'and aborted when the document goes away');
	// A `pagehide` into the back/forward cache is not the document going away.
	// Aborting there leaves the signal aborted after the restore, and `waitWith`
	// rejects immediately on an already-aborted signal — so the two waits in
	// `watchers.js` would fail before observing anything, and nothing appended
	// after a restore would run its visible tasks.
	assert.match(init, /event\.persisted/, 'a bfcache pagehide must not abort the page signal');

	// Both waits are awaited inside watcher callbacks whose return value is
	// discarded, so an abort that propagates becomes an unhandled rejection — one
	// per pending waiter on every navigation away.
	const watcherSource = readRepoFile('lib/utils/watchers.js');
	assert.equal((watcherSource.match(/if \(!isAbortError\(e\)\) throw e;/g) || []).length, 2,
		'both page-signal waits must swallow their own abort and rethrow anything else');

	// By line, not by a balanced-paren regex: the selector these are called with
	// contains its own parentheses, and a non-greedy match stops inside it.
	const watchers = readRepoFile('lib/utils/watchers.js').split(/\r?\n/);
	for (const call of ['waitForSelectorMatch(', 'waitForAttach(']) {
		const line = watchers.find(l => l.includes(`await ${call}`));
		assert.ok(line, `${call} should still be awaited from the watcher`);
		assert.match(line, /signal: getPageSignal\(\)/, `${call} holds an observer per thing and must carry the page signal`);
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
