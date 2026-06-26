/* @flow */
// Pre-migration IDB backup helpers. Before bumping an IndexedDB schema
// version, call backupStore() to snapshot the store's contents into
// chrome.storage.local. If the migration fails, restoreStore() can
// recover the data.
//
// Backup key format: `idb-backup::${dbName}::${storeName}`
// Value: JSON-stringified array of records.

import { Storage } from '../environment';

function backupKey(dbName: string, storeName: string): string {
	return `idb-backup::${dbName}::${storeName}`;
}

export async function backupStore(dbName: string, storeName: string, schemaVersion: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(dbName, schemaVersion);
		req.onsuccess = async () => {
			const db = req.result;
			try {
				const tx = db.transaction(storeName, 'readonly');
				const store = tx.objectStore(storeName);
				const all = store.getAll();
				all.onsuccess = async () => {
					const records = all.result || [];
					const key = backupKey(dbName, storeName);
					await Storage.set(key, JSON.stringify(records));
					db.close();
					resolve(records.length);
				};
				all.onerror = () => { db.close(); reject(all.error); };
			} catch (err) {
				db.close();
				reject(err);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

export async function restoreStore(dbName: string, storeName: string, schemaVersion: number): Promise<number> {
	const key = backupKey(dbName, storeName);
	const raw = await Storage.get(key);
	if (!raw) return 0;
	let records;
	try { records = JSON.parse(raw); } catch { return 0; }
	if (!Array.isArray(records) || records.length === 0) return 0;

	return new Promise((resolve, reject) => {
		const req = indexedDB.open(dbName, schemaVersion);
		req.onsuccess = async () => {
			const db = req.result;
			try {
				const tx = db.transaction(storeName, 'readwrite');
				const store = tx.objectStore(storeName);
				for (const record of records) store.put(record);
				tx.oncomplete = () => { db.close(); resolve(records.length); };
				tx.onerror = () => { db.close(); reject(tx.error); };
			} catch (err) {
				db.close();
				reject(err);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

export async function clearBackup(dbName: string, storeName: string): Promise<void> {
	const key = backupKey(dbName, storeName);
	await Storage.set(key, null);
}
