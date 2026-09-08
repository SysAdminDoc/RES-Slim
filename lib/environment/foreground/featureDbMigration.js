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

// How much of each store has already been copied, and how many attempts in a row
// have failed.
//
// Separate from the marker above because that one's shape is "this store is
// finished, and here is how many it had", and a profile in the wild already has
// one. This is the half-done state, and it is what makes a failed copy cost the
// next page load only the part that did not land.
type MigrationProgress = {| copied: number, failures: number |};
const progressStore = Storage.wrap('RESmodules.featureData.migrationProgress', ({}: { [string]: MigrationProgress }));

// Records per message. The bridge is `chrome.runtime.sendMessage`, which
// serialises the whole payload: a fifty-thousand record vote history with
// 240-character snippets does not fit in one, and the failure was not reported
// anywhere -- the copy simply started again from nothing on the next page load,
// for the life of the profile.
export const MIGRATION_BATCH_SIZE = 2000;

// Attempts in a row before this stops being only a console warning. The records
// are still in the old database, so nothing is lost by carrying on trying; what
// was wrong was that nobody could find out it was happening.
export const MIGRATION_FAILURE_LIMIT = 3;

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

// `reportFailure` is passed in rather than imported: the module error log lives
// under `lib/core/`, which imports this layer, so reaching back for it would be a
// cycle. `foreground.entry.js` owns both and wires them together.
export async function migrateLegacyFeatureStores(
	reportFailure: (storeId: string, attempts: number, error: mixed) => void = () => {},
): Promise<{ [string]: number }> {
	if (typeof indexedDB === 'undefined') return {};
	// A private window sees an empty copy of reddit.com's storage, so migrating
	// from it would copy nothing and then write a marker that stops the real
	// profile from ever migrating: the marker lives in extension storage, which
	// a private window shares with the normal one.
	if (isPrivateBrowsing()) return {};
	let done: { [string]: number };
	try { done = { ...(await migratedStore.get() || {}) }; } catch { return {}; }
	let progress: { [string]: MigrationProgress };
	try { progress = { ...(await progressStore.get() || {}) }; } catch { progress = {}; }
	const saveProgress = () => progressStore.set(progress).catch(() => { /* the copy still happened */ });

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
		const state: MigrationProgress = progress[descriptor.id] || { copied: 0, failures: 0 };
		try {
			// Sequential on purpose: four databases opened at once on the first
			// Reddit page load after an upgrade is four upgrade transactions
			// competing while the page is still rendering.
			// eslint-disable-next-line no-await-in-loop
			const { records, created } = await readLegacyStore(descriptor);
			// The open we just did is what brought this database into existence.
			// eslint-disable-next-line no-await-in-loop
			if (created) await deleteDatabase(descriptor.legacy.dbName);

			// Resume where the last attempt stopped rather than starting over.
			// `getAll` answers in key order and nothing writes the old database any
			// more -- the code that did is gone -- so the prefix already copied is the
			// same prefix every time.
			let copied = Math.min(state.copied, records.length);
			const resumedFrom = copied;
			while (copied < records.length) {
				const batch = records.slice(copied, copied + MIGRATION_BATCH_SIZE);
				// eslint-disable-next-line no-await-in-loop
				await writeRecords(descriptor.id, batch, []);
				copied += batch.length;
				state.copied = copied;
				progress[descriptor.id] = state;
				// eslint-disable-next-line no-await-in-loop
				await saveProgress();
			}

			done[descriptor.id] = records.length;
			moved[descriptor.id] = records.length - resumedFrom;
			delete progress[descriptor.id];
			// eslint-disable-next-line no-await-in-loop
			await saveProgress();
		} catch (error) {
			// The marker stays unset so the next page load tries again -- the records
			// are still in the old database, so there is nothing to lose by trying.
			// What it does not do any more is start from nothing, or fail in silence.
			state.failures += 1;
			progress[descriptor.id] = state;
			// eslint-disable-next-line no-await-in-loop
			await saveProgress();
			if (state.failures >= MIGRATION_FAILURE_LIMIT) {
				try { reportFailure(descriptor.id, state.failures, error); } catch { /* reporting must not stop the next store */ }
			}
		}
	}

	try { await migratedStore.set(done); } catch { /* the copy still happened */ }
	return moved;
}
