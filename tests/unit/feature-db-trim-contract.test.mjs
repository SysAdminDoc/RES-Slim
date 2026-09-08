// Dropping the oldest records without reading any of them.
//
// The vote log's prune is the caller: at its default cap of fifty thousand
// records with 240-character snippets, reading the store into the content script
// to decide what to delete marshalled tens of megabytes through
// `chrome.runtime.sendMessage` for one vote click. A cursor over the timestamp
// index does the same work where the records already are.
//
// What is executed here is the arithmetic and the ordering: how many go, which
// ones, and what happens at the edges. IndexedDB itself is stood in for -- the
// double below implements exactly the four calls this function makes and nothing
// else, so it can say the loop is right and cannot say the browser agrees.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

// A store of records, plus an index that walks them in a chosen order.
//
// The one thing this has to get right beyond the four calls the subject makes is
// *when* a transaction completes: IndexedDB fires `oncomplete` after the last
// request it issued has settled, and a double that fires it on a fixed timer
// resolves the caller before the cursor has finished walking. So it counts
// outstanding requests and completes when the count reaches zero.
function fakeDb(seed) {
	const state = { records: [...seed], transactions: [], reads: 0 };
	let active = null;

	const request = () => {
		const pending = {};
		if (active) active.outstanding += 1;
		const settle = () => {
			if (pending.onsuccess) pending.onsuccess();
			if (active) {
				active.outstanding -= 1;
				active.check();
			}
		};
		return { pending, settle };
	};

	const cursorOver = (ordered, onDelete) => {
		const { pending, settle } = request();
		let position = -1;
		const step = () => {
			position += 1;
			const record = position >= ordered.length ? null : ordered[position];
			pending.result = record === null ? null : {
				value: record,
				delete: () => { onDelete(record); },
				continue: () => {
					if (active) active.outstanding += 1;
					queueMicrotask(step);
				},
			};
			settle();
		};
		queueMicrotask(step);
		return pending;
	};

	const indexed = name => {
		const ordered = () => [...state.records].sort((left, right) => left[name] - right[name]);
		return {
			count() {
				const { pending, settle } = request();
				queueMicrotask(() => { pending.result = state.records.length; settle(); });
				return pending;
			},
			getAll() {
				state.reads += 1;
				const { pending, settle } = request();
				queueMicrotask(() => { pending.result = ordered(); settle(); });
				return pending;
			},
			openCursor() {
				return cursorOver(ordered(), record => {
					state.records = state.records.filter(candidate => candidate !== record);
				});
			},
		};
	};

	state.indexedDB = {
		open() {
			const opening = {};
			queueMicrotask(() => {
				opening.result = {
					objectStoreNames: { contains: () => true },
					createObjectStore: () => ({ createIndex() {} }),
					close() {},
					transaction(name, mode) {
						const transaction = { mode, outstanding: 0, done: false, handlers: {} };
						transaction.check = () => {
							if (transaction.done || transaction.outstanding > 0) return;
							transaction.done = true;
							if (transaction.handlers.oncomplete) transaction.handlers.oncomplete();
						};
						state.transactions.push(transaction);
						active = transaction;
						// A transaction that is handed no requests at all still completes.
						queueMicrotask(() => queueMicrotask(() => transaction.check()));
						const handle = {
							mode: transaction.mode,
							abort() { transaction.done = true; },
							objectStore: () => ({ index: indexed }),
						};
						// The subject assigns these; recording them on the transaction is
						// what lets `check()` fire the right one at the right moment.
						for (const name of ['oncomplete', 'onerror', 'onabort']) {
							Reflect.defineProperty(handle, name, {
								configurable: true,
								set(fn) { transaction.handlers[name] = fn; },
								get() { return transaction.handlers[name]; },
							});
						}
						return handle;
					},
				};
				if (opening.onsuccess) opening.onsuccess();
			});
			return opening;
		},
	};
	return state;
}

function records(count) {
	return Array.from({ length: count }, (_, index) => ({ id: `v${index}`, timestamp: 1000 + index }));
}

function loadWith(state) {
	globalThis.indexedDB = state.indexedDB;
	// A fresh copy per test: the module memoises its database handle.
	return loadFlowModule('lib/environment/background/featureDb.js', `feature-db-trim-${Math.random().toString(36).slice(2)}`, {
		stubs: {
			'./messaging': 'export function addListener() {}\n',
			'../../utils/async': 'export function keyedMutex(fn) { return fn; }\n',
			'../../utils/featureStores': `
export const FEATURE_DB_NAME = 'rsm-featureData';
export const FEATURE_DB_VERSION = 1;
export const FEATURE_STORES = [{ id: 'voteHistory', keyPath: 'id', indexes: [{ name: 'timestamp', keyPath: 'timestamp' }] }];
export function getFeatureStore(id) { return FEATURE_STORES.find(store => store.id === id); }
export function describeOpenFailure(error) { return error; }
`,
		},
	});
}

test('the overflow goes, oldest first, and nothing else does', async () => {
	const state = fakeDb(records(25));
	const db = await loadWith(state);

	const deleted = await db.trimFeatureRecords('voteHistory', 'timestamp', 10);
	assert.equal(deleted, 15);
	assert.equal(state.records.length, 10);

	// The ten that survive are the ten newest, in the order the index walks.
	assert.deepEqual(state.records.map(record => record.id), Array.from({ length: 10 }, (_, index) => `v${index + 15}`));

	// And it read nothing, which is the entire reason this exists.
	assert.equal(state.reads, 0, 'the trim read the store back');
});

test('a store already under the cap is not touched', async () => {
	const state = fakeDb(records(8));
	const db = await loadWith(state);

	assert.equal(await db.trimFeatureRecords('voteHistory', 'timestamp', 50), 0);
	assert.equal(state.records.length, 8);
	// Exactly at the cap is under it.
	assert.equal(await db.trimFeatureRecords('voteHistory', 'timestamp', 8), 0);
	assert.equal(state.records.length, 8);
});

test('keeping none empties it, and keeping nonsense keeps nothing rather than everything', async () => {
	// A cap is a bound. A caller that passes rubbish should not silently get "no
	// limit", which is the failure this direction protects against.
	for (const keep of [0, -5, NaN, undefined, 'ten']) {
		const state = fakeDb(records(6));
		// eslint-disable-next-line no-await-in-loop
		const db = await loadWith(state);
		// eslint-disable-next-line no-await-in-loop
		assert.equal(await db.trimFeatureRecords('voteHistory', 'timestamp', keep), 6, String(keep));
		assert.equal(state.records.length, 0, String(keep));
	}
});

test('trimming with no index is refused rather than guessed at', async () => {
	// Without an index the cursor walks key order, and this store is keyed on a
	// generated id -- so "oldest" would mean whatever the ids happen to sort as.
	const state = fakeDb(records(10));
	const db = await loadWith(state);

	await assert.rejects(() => db.trimFeatureRecords('voteHistory', null, 5), /index/i);
	assert.equal(state.records.length, 10, 'a refused trim deleted something anyway');
});

test('the deletes happen in one read-write transaction', async () => {
	const state = fakeDb(records(12));
	const db = await loadWith(state);

	await db.trimFeatureRecords('voteHistory', 'timestamp', 4);
	assert.equal(state.transactions.length, 1, `the trim opened ${state.transactions.length} transactions`);
	assert.equal(state.transactions[0].mode, 'readwrite');
});
