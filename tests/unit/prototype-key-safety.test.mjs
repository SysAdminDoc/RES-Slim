// Keys that come from reddit and land in a plain object.
//
// Every map in this extension keyed by a username, a subreddit or a module id is
// keyed by a string somebody else chose, and reddit allows names that are also
// members of `Object.prototype`. Two different failures follow from that:
//
//   - reading. `blob[key]` walks the prototype chain, so a lookup for a user
//     called `toString` or `constructor` returns a function instead of the
//     default, and a `has()` built the same way answers true for a key nothing
//     ever stored. `userTagger` survives that by accident, because the only
//     thing it reads off a "tag" is `.color`.
//   - writing. Assigning to `__proto__` on an object literal sets the prototype
//     rather than adding an entry, so one entry in an imported file would have
//     rewritten every object in the page.
//
// Executed rather than pattern-matched: the whole point is what the member
// access does at runtime.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const objectUtils = await loadFlowModule('lib/utils/object.js', 'proto-safety-object');
const userTags = await loadFlowModule('lib/utils/userTags.js', 'proto-safety-user-tags');
const snapshot = await loadFlowModule('lib/core/options/snapshot.js', 'proto-safety-snapshot', {
	stubs: {
		'../../environment/foreground/storage': [
			'export const get = async () => null;',
			'export const set = async () => {};',
			'export const getAll = async () => ({});',
			'export const wrap = () => ({ get: async () => null, set: async () => {}, delete: async () => {} });',
		].join('\n'),
		'./storage': 'export const storage = { getAll: async () => ({}), get: async () => null, set: async () => {} };\n',
	},
});

// The blob store itself, with the real `BlobWrapper` reading through a stubbed
// `chrome.storage.local`. Nothing else in this file can show the read side.
const backing = new Map();
globalThis.chrome = {
	storage: {
		local: {
			get(items, callback) {
				const out = {};
				for (const [key, fallback] of Object.entries(items)) out[key] = backing.has(key) ? backing.get(key) : fallback;
				callback(out);
			},
			set(items, callback) {
				for (const [key, value] of Object.entries(items)) backing.set(key, value);
				callback();
			},
			remove(keys, callback) {
				for (const key of [].concat(keys)) backing.delete(key);
				callback();
			},
		},
	},
	runtime: { lastError: null },
};

const storage = await loadFlowModule('lib/environment/foreground/storage.js', 'proto-safety-storage', {
	stubs: {
		'../../utils/functional': [
			'export const transform = (items, fn, seed) => { for (const item of items) fn(seed, item); return seed; };',
			'export const once = fn => fn;',
		].join('\n'),
		'../../utils/object': 'export const extendDeep = (target, source) => Object.assign(target, source);',
		'../../utils/async': [
			'export const keyedMutex = fn => fn;',
			'export const batch = fn => (key => fn([key]).then(values => values[0]));',
		].join('\n'),
		'../utils/api': [
			'export const store = new Map();',
			'export const apiToPromise = fn => ((...args) => new Promise(resolve => fn(...args, resolve)));',
		].join('\n'),
		'./messaging': 'export const sendMessage = async () => undefined;',
		'./privateBrowsing': 'export const guardFeatureDataMutation = (id, mutation) => mutation();',
	},
});

test('a blob lookup answers for what was stored, not for Object.prototype', async () => {
	const wrapper = storage.wrapBlob('RES.protoSafety', () => null);
	await wrapper.set('alice', { tag: 'ok' });

	// Every one of these is a valid reddit username.
	const names = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];
	const reads = await Promise.all(names.map(async name => ({
		name,
		get: await wrapper.get(name),
		nullable: await wrapper.getNullable(name),
		has: await wrapper.has(name),
	})));
	for (const read of reads) {
		assert.equal(read.get, null, `get(${read.name}) returned a prototype member`);
		assert.equal(read.nullable, null, `getNullable(${read.name}) returned a prototype member`);
		assert.equal(read.has, false, `has(${read.name}) claimed a key that was never stored`);
	}

	assert.deepEqual(await wrapper.get('alice'), { tag: 'ok' }, 'an ordinary key still reads back');
	assert.equal(await wrapper.has('alice'), true);
	assert.deepEqual(
		await wrapper.getMultiple(['alice', 'constructor']),
		{ alice: { tag: 'ok' }, constructor: null },
	);
});

test('extendDeep will not write through a prototype key', () => {
	const target = {};
	objectUtils.extendDeep(target, JSON.parse('{"__proto__": {"polluted": 1}}'));
	assert.equal(({}).polluted, undefined, 'Object.prototype was written to');
	assert.equal(Object.getPrototypeOf(target), Object.prototype, 'the target got a new prototype');

	// And the ordinary path still merges.
	const merged = objectUtils.extendDeep({ a: { b: 1 } }, { a: { c: 2 }, d: 3 });
	assert.deepEqual(merged, { a: { b: 1, c: 2 }, d: 3 });
});

test('a username that is a prototype member is not a username', () => {
	for (const name of ['__proto__', 'constructor', 'prototype', '__PROTO__']) {
		assert.equal(userTags.normalizeUsername(name), '', `${name} was accepted as a username`);
	}
	assert.equal(userTags.normalizeUsername('  Spez '), 'spez', 'an ordinary name still normalises');
});

test('a tag map drops the entries that would rewrite the prototype', () => {
	const map = userTags.normalizeTagMap(JSON.parse(
		'{"__proto__": {"tag": "x", "color": "", "ignore": false}, "alice": {"tag": "ok", "color": "", "ignore": false}}',
	));
	assert.deepEqual(Object.keys(map), ['alice']);
	// `Object.keys` cannot see this one: assigning `__proto__` on an object
	// literal replaces the prototype instead of adding an entry, so the map came
	// back looking correct while every lookup on it walked into the tag object.
	assert.equal(Object.getPrototypeOf(map), Object.prototype, 'the tag map got a new prototype');
	assert.equal(map.alice.tag, 'ok');
});

test('a settings file cannot import a module called constructor', () => {
	const file = {
		app: 'res-slim',
		formatVersion: 1,
		modules: JSON.parse('{"__proto__": {"a": 1}, "constructor": {"b": 2}, "hover": {"fadeSpeed": {"value": "0.7"}}}'),
	};
	const parsed = snapshot.parseSnapshot(JSON.stringify(file));
	assert.deepEqual(Object.keys(parsed.modules), ['hover']);
	assert.equal(({}).a, undefined, 'Object.prototype was written to');
});
