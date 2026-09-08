// The one primitive several tabs can agree on.
//
// Everything else in storage is per-tab: the foreground holds a `keyedMutex`
// that serialises writes within one document and can see nothing outside it. So
// a read-modify-write from two tabs interleaves, and the second write wins
// silently. `storage-cas` exists because the background is the one place both
// tabs reach, and it was the reason the tag import could wipe itself.
//
// It also could not work, for as long as it had no callers. The comparison was
// `storedValue !== oldValue`: identity, on two values that have each been
// through JSON on the way here. For a string or a number that is fine and for
// anything worth comparing and setting it is not, because two objects holding
// the same thing are never the same object.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

// The store, plus the listener the module registers, captured on the way past.
async function loadHandler(initial = {}) {
	const state = { data: { ...initial }, listeners: {} };
	globalThis.chrome = {
		storage: {
			local: {
				get(keys, callback) {
					const out = {};
					for (const [key, fallback] of Object.entries(keys)) {
						out[key] = Object.hasOwn(state.data, key) ? state.data[key] : fallback;
					}
					callback(out);
				},
				set(items, callback) {
					Object.assign(state.data, items);
					callback();
				},
			},
		},
		runtime: { lastError: undefined },
	};

	await loadFlowModule('lib/environment/background/storage.js', `storage-cas-${Math.random().toString(36).slice(2)}`, {
		stubs: {
			'./messaging': `
export function addListener(type, callback) { globalThis.__casListeners[type] = callback; }
`,
			'../utils/api': `
export function apiToPromise(fn) {
	return (...args) => new Promise(resolve => { fn(...args, resolve); });
}
`,
			// A faithful mutex rather than an identity function: serialising per key
			// is half of what makes this primitive work, and a stub that skips it would
			// let both racers win and call that a pass. That the product wraps the
			// handler in the real one is asserted separately below.
			'../../utils/async': `
export function keyedMutex(fn, keyOf) {
	const chains = new Map();
	return (...args) => {
		const key = keyOf ? keyOf(...args) : '';
		const previous = chains.get(key) || Promise.resolve();
		const next = previous.then(() => fn(...args), () => fn(...args));
		chains.set(key, next.then(() => {}, () => {}));
		return next;
	};
}
`,
		},
	});
	state.cas = globalThis.__casListeners['storage-cas'];
	return state;
}

test('an object that has not changed compares equal, however it was serialised', async () => {
	// The failure this replaces. Both of these are the same tags; neither is the
	// same object as the other, and their keys are in different orders because
	// nothing preserves key order through storage and a message bridge.
	globalThis.__casListeners = {};
	const stored = { alice: { tag: 'a', ts: 1 }, bob: { tag: 'b', ts: 2 } };
	const state = await loadHandler({ tags: stored });

	const asRead = { bob: { ts: 2, tag: 'b' }, alice: { ts: 1, tag: 'a' } };
	const next = { ...stored, carol: { tag: 'c', ts: 3 } };

	assert.equal(await state.cas(['tags', null, asRead, next]), true, 'an unchanged map compared as changed');
	assert.deepEqual(state.data.tags, next);
});

test('an object that has changed is refused, and nothing is written', async () => {
	globalThis.__casListeners = {};
	const state = await loadHandler({ tags: { alice: { tag: 'theirs' } } });

	const stale = { alice: { tag: 'mine' } };
	const next = { alice: { tag: 'mine' }, bob: { tag: 'mine too' } };

	assert.equal(await state.cas(['tags', null, stale, next]), false);
	assert.deepEqual(state.data.tags, { alice: { tag: 'theirs' } }, 'a refused write landed anyway');
});

test('two writers racing the same key, and only one of them wins', async () => {
	// What the tag import needs: both read the same map, both try to write, one
	// is told no and nothing is lost.
	globalThis.__casListeners = {};
	const start = { alice: { tag: 'old' } };
	const state = await loadHandler({ tags: start });

	const fromA = { ...start, bob: { tag: 'from A' } };
	const fromB = { ...start, carol: { tag: 'from B' } };

	const results = await Promise.all([
		state.cas(['tags', null, start, fromA]),
		state.cas(['tags', null, start, fromB]),
	]);

	assert.deepEqual(results.filter(Boolean).length, 1, `${results.filter(Boolean).length} writers were told they won`);
	assert.ok(
		JSON.stringify(state.data.tags) === JSON.stringify(fromA) || JSON.stringify(state.data.tags) === JSON.stringify(fromB),
		'the stored map is neither of the two imports',
	);
});

test('the primitives it was already right about stay right', async () => {
	globalThis.__casListeners = {};
	const state = await loadHandler({ count: 3, flag: true, name: 'x', nothing: null });

	assert.equal(await state.cas(['count', 0, 3, 4]), true);
	assert.equal(state.data.count, 4);
	assert.equal(await state.cas(['count', 0, 3, 5]), false, 'a stale number was accepted');
	assert.equal(state.data.count, 4);

	assert.equal(await state.cas(['flag', false, true, false]), true);
	assert.equal(await state.cas(['name', '', 'x', 'y']), true);
	assert.equal(await state.cas(['nothing', null, null, 'something']), true);

	// A key that was never set compares against the default it was given.
	assert.equal(await state.cas(['absent', 'fallback', 'fallback', 'set']), true);
	assert.equal(state.data.absent, 'set');
	assert.equal(await state.cas(['stillAbsent', null, 'guess', 'set']), false);
});

test('null and an object are not the same thing', async () => {
	// The cheap way to write a structural compare is to stringify both sides,
	// and `JSON.stringify(null)` is a string that a careless implementation will
	// happily match against something else.
	globalThis.__casListeners = {};
	const state = await loadHandler({ tags: null });

	assert.equal(await state.cas(['tags', null, {}, { alice: {} }]), false, 'null matched an empty object');
	assert.equal(state.data.tags, null);
	assert.equal(await state.cas(['tags', null, null, { alice: {} }]), true);
});

test('values that are not the same do not compare the same', async () => {
	// The cheap structural compare gets several of these wrong. `NaN`, `Infinity`
	// and `-Infinity` all stringify as `null`, so a naive version says each of
	// them equals a stored null and equals the others. An array and an object with
	// numeric keys serialise alike once the keys are sorted and quoted. A Date has
	// a `toJSON`, so comparing the raw object says every Date is every other Date.
	globalThis.__casListeners = {};
	const state = await loadHandler({});

	const different = [
		['NaN and null', NaN, null],
		['Infinity and null', Infinity, null],
		['NaN and Infinity', NaN, Infinity],
		['an array and an object with numeric keys', [1, 2], { 0: 1, 1: 2 }],
		['two dates', new Date(0), new Date(99_999)],
		['a date and an empty object', new Date(0), {}],
		['a number and its text', 1, '1'],
		['nested shapes', { a: { b: 1 } }, { a: { b: '1' } }],
	];
	for (const [what, stored, claimed] of different) {
		state.data.k = stored;
		// eslint-disable-next-line no-await-in-loop
		const wrote = await state.cas(['k', null, claimed, 'replaced']);
		assert.equal(wrote, false, `${what} compared equal`);
		assert.notEqual(state.data.k, 'replaced', `${what} let a stale write through`);
	}

	// And the pairs that really are the same still are, whichever way they got
	// here.
	const same = [
		['zero and minus zero', 0, -0],
		['the same array', [1, { b: 2 }], [1, { b: 2 }]],
		['the same date', new Date(1234), new Date(1234)],
		['keys in another order', { a: 1, b: 2 }, { b: 2, a: 1 }],
	];
	for (const [what, stored, claimed] of same) {
		state.data.k = stored;
		// eslint-disable-next-line no-await-in-loop
		assert.equal(await state.cas(['k', null, claimed, 'replaced']), true, `${what} compared different`);
	}
});

test('a value it cannot walk is refused rather than thrown out of', async () => {
	// A compare-and-set that throws leaves its caller with an exception where it
	// expected an answer, on a path that has usually already written something
	// else. "It changed" is a reply the caller knows what to do with.
	globalThis.__casListeners = {};
	const state = await loadHandler({});

	const cyclic = { name: 'loop' };
	cyclic.self = cyclic;
	state.data.k = { name: 'loop' };
	assert.equal(await state.cas(['k', null, cyclic, 'replaced']), false);
	assert.notEqual(state.data.k, 'replaced');

	// Deeper than anything this extension stores, and deep enough that walking it
	// without a bound overflows the stack.
	let deep = {};
	const root = deep;
	for (const _step of Array.from({ length: 200_000 })) { // eslint-disable-line no-unused-vars
		deep.next = {};
		deep = deep.next;
	}
	state.data.k = 'something else';
	assert.equal(await state.cas(['k', null, root, 'replaced']), false);

	// A value that cannot be serialised at all, for a reason the depth bound does
	// not cover. Nothing reaches the handler as a BigInt in the product -- the
	// message bridge is JSON -- but a comparison is the wrong place to find out
	// that something cannot be compared.
	state.data.k = 'something else';
	assert.equal(await state.cas(['k', null, { big: 1n }, 'replaced']), false);
	assert.notEqual(state.data.k, 'replaced');

	// And the key is not wedged afterwards: the mutex has to release even when the
	// comparison could not be made.
	state.data.k = 'something else';
	assert.equal(await state.cas(['k', null, 'something else', 'replaced']), true);
	assert.equal(state.data.k, 'replaced');
});

test('the handler is serialised per key by the real mutex', () => {
	// The contract above runs against a stand-in for `keyedMutex`, so it can show
	// that serialising is necessary and not that the product does it. This is the
	// half it cannot see.
	const block = readRepoFile('lib/environment/background/storage.js');
	assert.match(block, /addListener\('storage-cas', keyedMutex\(/, 'the compare-and-set handler is not serialised');
	// Keyed on the storage key, so two keys do not queue behind each other.
	assert.match(block, /\}, \(\[key\]\) => key\)\);/);
});
