/* @flow */
// The one IndexedDB this extension owns, in the extension's own origin.
//
// Content scripts cannot open it: their `indexedDB` belongs to reddit.com. They
// go through the four messages below, which is also what makes the settings
// page able to read the same records — it is served from this origin, so it
// shares this database with the background page.
//
// Every write is serialised per store. A read-modify-write from a content
// script still spans two messages, so two tabs syncing the same account can
// interleave; what this guarantees is that a single write lands whole.

import { keyedMutex } from '../../utils/async';
import { FEATURE_DB_NAME, FEATURE_DB_VERSION, FEATURE_STORES, describeOpenFailure, getFeatureStore } from '../../utils/featureStores';
import { addListener } from './messaging';

let dbPromise: ?Promise<any> = null;

function openDb(): Promise<any> {
	if (dbPromise) return dbPromise;
	const pending = new Promise((resolve, reject) => {
		try {
			const request = indexedDB.open(FEATURE_DB_NAME, FEATURE_DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				for (const descriptor of FEATURE_STORES) {
					if (db.objectStoreNames.contains(descriptor.id)) continue;
					const store = db.createObjectStore(descriptor.id, { keyPath: descriptor.keyPath });
					for (const index of descriptor.indexes) store.createIndex(index.name, index.keyPath);
				}
			};
			request.onsuccess = () => {
				// A second context upgrading the schema must not be blocked by this
				// one holding the old version open.
				request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
				resolve(request.result);
			};
			request.onerror = () => reject(describeOpenFailure(request.error));
		} catch (error) { reject(error); }
	});
	dbPromise = pending;
	pending.catch(() => { dbPromise = null; });
	return pending;
}

function source(store: any, index: ?string): any {
	return index ? store.index(index) : store;
}

async function transact<T>(storeId: string, mode: string, run: (store: any, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
	const descriptor = getFeatureStore(storeId);
	const db = await openDb();
	return new Promise((resolve, reject) => {
		let settled;
		try {
			const transaction = db.transaction(descriptor.id, mode);
			transaction.onerror = () => reject(transaction.error || new Error(`Could not use the ${descriptor.id} store`));
			transaction.onabort = () => reject(transaction.error || new Error(`The ${descriptor.id} transaction was aborted`));
			transaction.oncomplete = () => resolve((settled: any));
			run(transaction.objectStore(descriptor.id), value => { settled = value; }, error => { reject(error); transaction.abort(); });
		} catch (error) { reject(error); }
	});
}

export function readFeatureRecords(storeId: string, index: ?string, value: mixed): Promise<Array<any>> {
	return transact(storeId, 'readonly', (store, done, fail) => {
		const request = value === undefined || value === null ?
			source(store, index).getAll() :
			source(store, index).getAll((value: any));
		request.onsuccess = () => done(request.result || []);
		request.onerror = () => fail(request.error || new Error('Could not read the store'));
	});
}

export function countFeatureRecords(storeId: string, index: ?string, value: mixed): Promise<number> {
	return transact(storeId, 'readonly', (store, done, fail) => {
		const request = value === undefined || value === null ?
			source(store, index).count() :
			source(store, index).count((value: any));
		request.onsuccess = () => done(request.result || 0);
		request.onerror = () => fail(request.error || new Error('Could not count the store'));
	});
}

// Drop everything past the newest `keep` records, in the background, without any
// of them crossing the bridge.
//
// The alternative a caller has is to read the store, sort it and send the ids
// back to delete, and at the vote log's default cap of fifty thousand records
// with 240-character snippets that is tens of megabytes marshalled through
// `chrome.runtime.sendMessage` for one vote click. A cursor over the index does
// the same work where the records already are.
//
// `index` decides what "oldest" means: an index cursor walks in index order, so
// `timestamp` gives oldest-first. Without one it is key order, which for a store
// keyed on a generated id is not what a caller trimming by age wants -- so this
// refuses rather than guessing.
export function trimFeatureRecords(storeId: string, index: ?string, keep: number): Promise<number> {
	if (!index) return Promise.reject(new Error('Trimming needs an index to decide what is oldest'));
	const wanted = Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : 0;

	return transact(storeId, 'readwrite', (store, done, fail) => {
		const src = source(store, index);
		const counted = src.count();
		counted.onerror = () => fail(counted.error || new Error('Could not count the store'));
		counted.onsuccess = () => {
			const total = counted.result || 0;
			let remaining = Math.max(0, total - wanted);
			if (!remaining) { done(0); return; }

			const target = remaining;
			const cursorRequest = src.openCursor();
			cursorRequest.onerror = () => fail(cursorRequest.error || new Error('Could not walk the store'));
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				// Out of records before the target is a store that shrank under us, not
				// an error: report what was actually deleted.
				if (!cursor || remaining <= 0) { done(target - remaining); return; }
				cursor.delete();
				remaining -= 1;
				cursor.continue();
			};
		};
	});
}

// `put` and `remove` in one transaction so a replace cannot leave the store
// holding neither version.
const writeFeatureRecords = keyedMutex(
	(storeId: string, put: Array<any>, remove: Array<any>): Promise<number> => transact(storeId, 'readwrite', (store, done) => {
		for (const key of remove) store.delete((key: any));
		for (const record of put) store.put(record);
		done(put.length + remove.length);
	}),
	(storeId: string) => storeId,
);

export { writeFeatureRecords };

export function getFeatureRecord(storeId: string, key: mixed): Promise<any | null> {
	return transact(storeId, 'readonly', (store, done, fail) => {
		const request = store.get((key: any));
		request.onsuccess = () => done(request.result || null);
		request.onerror = () => fail(request.error || new Error('Could not read the record'));
	});
}

export function clearFeatureStore(storeId: string): Promise<number> {
	return transact(storeId, 'readwrite', (store, done, fail) => {
		const request = store.count();
		request.onsuccess = () => { done(request.result || 0); store.clear(); };
		request.onerror = () => fail(request.error || new Error('Could not clear the store'));
	});
}

addListener('featureDb-read', ({ store, index, value }: any) => readFeatureRecords(store, index, value));
addListener('featureDb-count', ({ store, index, value }: any) => countFeatureRecords(store, index, value));
addListener('featureDb-get', ({ store, key }: any) => getFeatureRecord(store, key));
addListener('featureDb-write', ({ store, put, remove }: any) => writeFeatureRecords(store, Array.isArray(put) ? put : [], Array.isArray(remove) ? remove : []));
addListener('featureDb-clear', ({ store }: any) => clearFeatureStore(store));
addListener('featureDb-trim', ({ store, index, keep }: any) => trimFeatureRecords(store, index, keep));
