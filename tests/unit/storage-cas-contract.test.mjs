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

test('the handler is serialised per key by the real mutex', () => {
	// The contract above runs against a stand-in for `keyedMutex`, so it can show
	// that serialising is necessary and not that the product does it. This is the
	// half it cannot see.
	const block = readRepoFile('lib/environment/background/storage.js');
	assert.match(block, /addListener\('storage-cas', keyedMutex\(/, 'the compare-and-set handler is not serialised');
	// Keyed on the storage key, so two keys do not queue behind each other.
	assert.match(block, /\}, \(\[key\]\) => key\)\);/);
});
