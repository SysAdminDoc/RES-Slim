/* @flow */
// Move each local data set out of reddit.com's storage and into the
// extension's, once per profile.
//
// Only a Reddit page can do this. The records are in reddit.com's IndexedDB and
// nothing in the extension's own origin — background page, settings page — can
// see them, which is the whole reason they are moving.
//
// Nothing is deleted. The old database stays exactly as it was, so a profile
// that downgrades still has its history, and a migration that copies a partial
// set can be re-run by clearing the marker. The marker is only written after
// the copy resolves.

import { FEATURE_STORES } from '../../utils/featureStores';
import type { FeatureStoreDescriptor } from '../../utils/featureStores';
import { writeRecords } from './featureDb';
import { isPrivateBrowsing } from './privateBrowsing';
import * as Storage from './storage';

const migratedStore = Storage.wrap('RESmodules.featureData.migrated', ({}: { [string]: number }));

async function legacyDatabaseNames(): Promise<?Array<string>> {
	// Firefox only grew `databases()` in 126. Without it we cannot ask what
	// exists, and opening to find out would create an empty database — so the
	// caller falls back to opening and cleaning up after itself.
	if (typeof indexedDB === 'undefined' || typeof (indexedDB: any).databases !== 'function') return null;
	try {
		const list = await (indexedDB: any).databases();
		return list.map(entry => entry && entry.name).filter(Boolean);
	} catch { return null; }
}

type LegacyRead = {| records: Array<any>, created: boolean |};

// Opened without a version on purpose: this reads whatever schema the profile
// already has, and asking for a version would trigger an upgrade in a database
// that no longer has any code maintaining it.
function readLegacyStore(descriptor: FeatureStoreDescriptor): Promise<LegacyRead> {
	return new Promise((resolve, reject) => {
		let created = false;
		try {
			const request = indexedDB.open(descriptor.legacy.dbName);
			request.onupgradeneeded = () => { created = true; };
			request.onerror = () => reject(request.error || new Error(`Could not open ${descriptor.legacy.dbName}`));
			request.onsuccess = () => {
				const db = request.result;
				const names = db.objectStoreNames;
				const storeName = names.contains(descriptor.legacy.storeName) ?
					descriptor.legacy.storeName :
					(descriptor.legacy.altStoreName && names.contains(descriptor.legacy.altStoreName) ? descriptor.legacy.altStoreName : null);
				if (!storeName) { db.close(); resolve({ records: [], created }); return; }
				const defaults = storeName === descriptor.legacy.storeName ? null : descriptor.legacy.legacyDefaults;
				try {
					const read = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
					read.onsuccess = () => {
						db.close();
						const records = read.result || [];
						resolve({ records: defaults ? records.map(record => ({ ...defaults, ...record })) : records, created });
					};
					read.onerror = () => { db.close(); reject(read.error || new Error(`Could not read ${storeName}`)); };
				} catch (error) { db.close(); reject(error); }
			};
		} catch (error) { reject(error); }
	});
}

function deleteDatabase(name: string): Promise<void> {
	return new Promise(resolve => {
		try {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
			request.onblocked = () => resolve();
		} catch { resolve(); }
	});
}

export async function migrateLegacyFeatureStores(): Promise<{ [string]: number }> {
	if (typeof indexedDB === 'undefined') return {};
	// A private window sees an empty copy of reddit.com's storage, so migrating
	// from it would copy nothing and then write a marker that stops the real
	// profile from ever migrating: the marker lives in extension storage, which
	// a private window shares with the normal one.
	if (isPrivateBrowsing()) return {};
	let done: { [string]: number };
	try { done = { ...(await migratedStore.get() || {}) }; } catch { return {}; }

	const existing = await legacyDatabaseNames();
	const moved = {};

	for (const descriptor of FEATURE_STORES) {
		if (Object.hasOwn(done, descriptor.id)) continue;
		if (existing && !existing.includes(descriptor.legacy.dbName)) {
			// Nothing was ever written here. Record that so a profile that starts
			// fresh does not re-check on every page load for the rest of its life.
			done[descriptor.id] = 0;
			continue;
		}
		try {
			// Sequential on purpose: four databases opened at once on the first
			// Reddit page load after an upgrade is four upgrade transactions
			// competing while the page is still rendering.
			// eslint-disable-next-line no-await-in-loop
			const { records, created } = await readLegacyStore(descriptor);
			// The open we just did is what brought this database into existence.
			// eslint-disable-next-line no-await-in-loop
			if (created) await deleteDatabase(descriptor.legacy.dbName);
			// eslint-disable-next-line no-await-in-loop
			if (records.length) await writeRecords(descriptor.id, records, []);
			done[descriptor.id] = records.length;
			moved[descriptor.id] = records.length;
		} catch {
			// Leave the marker unset so the next page load tries again. A store
			// that cannot be read is not a store that should be given up on
			// silently, and the records are still in the old database either way.
		}
	}

	try { await migratedStore.set(done); } catch { /* the copy still happened */ }
	return moved;
}
