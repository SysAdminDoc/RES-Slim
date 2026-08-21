/* @flow */

export type StoreInfo = {|
	name: string,
	dbName: string,
	storeName: string,
	schemaVersion: number,
	count: number,
	cap: ?number,
|};

const KNOWN_STORES: Array<{| name: string, dbName: string, storeName: string, schemaVersion: number, cap: ?number |}> = [
	{ name: 'Vote History', dbName: 'rsm-voteHistory', storeName: 'votes', schemaVersion: 1, cap: 50000 },
	{ name: 'Media Manifest', dbName: 'rsm-mediaManifest', storeName: 'entries', schemaVersion: 1, cap: 20000 },
	{ name: 'Saved Content', dbName: 'rsm-savedContent', storeName: 'items', schemaVersion: 1, cap: 10000 },
	{ name: 'Subreddit Emoji', dbName: 'rsm-subredditEmotes', storeName: 'maps', schemaVersion: 1, cap: 250 },
];

function countRecords(dbName: string, storeName: string, schemaVersion: number): Promise<number> {
	return new Promise(resolve => {
		try {
			const req = indexedDB.open(dbName, schemaVersion);
			req.onsuccess = () => {
				const db = req.result;
				try {
					if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(0); return; }
					const tx = db.transaction(storeName, 'readonly');
					const countReq = tx.objectStore(storeName).count();
					countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
					countReq.onerror = () => { db.close(); resolve(0); };
				} catch { db.close(); resolve(0); }
			};
			req.onerror = () => resolve(0);
		} catch { resolve(0); }
	});
}

export async function getStoreInfos(): Promise<StoreInfo[]> {
	const results: StoreInfo[] = [];
	for (const store of KNOWN_STORES) {
		const count = await countRecords(store.dbName, store.storeName, store.schemaVersion);
		results.push({ ...store, count });
	}
	return results;
}

export function clearStore(dbName: string, storeName: string, schemaVersion: number): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			const req = indexedDB.open(dbName, schemaVersion);
			req.onsuccess = () => {
				const db = req.result;
				try {
					if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(); return; }
					const tx = db.transaction(storeName, 'readwrite');
					tx.objectStore(storeName).clear();
					tx.oncomplete = () => { db.close(); resolve(); };
					tx.onerror = () => { db.close(); reject(tx.error); };
				} catch (err) { db.close(); reject(err); }
			};
			req.onerror = () => reject(req.error);
		} catch (err) { reject(err); }
	});
}

export function formatCount(info: StoreInfo): string {
	const pct = info.cap ? ` (${Math.round(info.count / info.cap * 100)}%)` : '';
	return `${info.name}: ${info.count.toLocaleString()}${info.cap ? ` / ${info.cap.toLocaleString()}${pct}` : ''}`;
}
