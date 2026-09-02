/* @flow */
// A content script's half of the extension-origin feature database.
//
// Deliberately dumb: no private-browsing policy is applied here, because the
// callers already own that decision and some of them have a fallback (the
// saved-content manager keeps a temporary in-tab index) that this layer must
// not pre-empt.

import { featureStoreKey, getFeatureStore } from '../../utils/featureStores';
import type { FeatureStoreDescriptor, FeatureStoreId } from '../../utils/featureStores';
import { sendMessage } from './messaging';

export function readRecords(store: FeatureStoreId, index?: ?string = null, value?: mixed = null): Promise<Array<any>> {
	return sendMessage('featureDb-read', { store, index, value });
}

export function countRecords(store: FeatureStoreId, index?: ?string = null, value?: mixed = null): Promise<number> {
	return sendMessage('featureDb-count', { store, index, value });
}

export function writeRecords(store: FeatureStoreId, put: Array<any> = [], remove: Array<mixed> = []): Promise<void> {
	if (!put.length && !remove.length) return Promise.resolve();
	return sendMessage('featureDb-write', { store, put, remove }).then(() => undefined);
}

export function clearRecords(store: FeatureStoreId): Promise<number> {
	return sendMessage('featureDb-clear', { store });
}

export function removeRecords(store: FeatureStoreId, records: Array<mixed>): Promise<void> {
	const descriptor = getFeatureStore(store);
	return writeRecords(store, [], records.map(record => featureStoreKey(descriptor, record)));
}

// One record, by key. A compound key travels as the array IndexedDB expects;
// an `IDBKeyRange` could not, because the bridge serialises to JSON.
export function readRecord(store: FeatureStoreId, key: mixed): Promise<any | null> {
	return sendMessage('featureDb-get', { store, key });
}

export type { FeatureStoreDescriptor, FeatureStoreId };
