// Two exported functions called `throttle`, and the call sites were written
// against the wrong one.
//
// `utils/async.js` exported `throttle(callback)`, a one-argument microtask
// coalescer, and it was the one in the `lib/utils` barrel. `utils/functional.js`
// exports `throttle(fn, wait)`, a time throttle. Both call sites of the second
// one call it as `throttle(fn, 100, { leading: true, trailing: false })` - the
// lodash signature - and the options were silently dropped, so a call site
// asking for the leading edge *only* also got a trailing call, which is the
// opposite of what it asked for.
//
// The microtask one is `microtaskThrottle` now, and the time throttle honours
// the options it was already being handed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const functional = await loadFlowModule('lib/utils/functional.js', 'throttle-functional');

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

test('the default throttle fires on the leading edge and again at the end of the window', async () => {
	const calls = [];
	const throttled = functional.throttle(value => calls.push(value), 40);

	throttled('a');
	throttled('b');
	throttled('c');
	assert.deepEqual(calls, ['a'], 'the first call goes through immediately');

	await sleep(80);
	// `b`, not `c`: the timer is armed by the first suppressed call and closes
	// over its arguments, where lodash would replay the most recent ones. Pinned
	// as what this function does rather than silently changed - no caller in this
	// repo uses the trailing edge any more, and the two that pass arguments both
	// ask for `trailing: false`.
	assert.deepEqual(calls, ['a', 'b'], 'the window ends with the first call it suppressed');
});

test('trailing: false drops what the window suppressed instead of replaying it', async () => {
	const calls = [];
	const throttled = functional.throttle(value => calls.push(value), 40, { leading: true, trailing: false });

	throttled('a');
	throttled('b');
	throttled('c');
	assert.deepEqual(calls, ['a']);

	await sleep(80);
	assert.deepEqual(calls, ['a'], 'a trailing call is exactly what this call site asked not to happen');

	// And the next window opens normally.
	throttled('d');
	assert.deepEqual(calls, ['a', 'd']);
});

test('leading: false waits out the first window', async () => {
	const calls = [];
	const throttled = functional.throttle(value => calls.push(value), 40, { leading: false });

	throttled('a');
	assert.deepEqual(calls, [], 'nothing on the leading edge');

	await sleep(80);
	assert.deepEqual(calls, ['a']);
});

test('the two throttles no longer share a name', () => {
	const asyncSource = readRepoFile('lib/utils/async.js');
	const barrel = readRepoFile('lib/utils/index.js');

	assert.match(asyncSource, /export function microtaskThrottle\(/);
	assert.doesNotMatch(asyncSource, /export function throttle\(/, 'the microtask coalescer is not a throttle in the lodash sense');
	assert.match(barrel, /\bmicrotaskThrottle,/);
	assert.doesNotMatch(barrel, /^\tthrottle,$/m, 'the barrel handed out the coalescer under the time throttle\'s name');

	// The local in selectedThing shadowed the imported one, so the file used two
	// different functions under one name.
	const selectedThing = readRepoFile('lib/utils/selectedThing.js');
	assert.match(selectedThing, /function throttleListeners\(/);
	assert.doesNotMatch(selectedThing, /\tfunction throttle\(/);
});
