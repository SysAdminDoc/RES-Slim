/* @flow */

import { canPersistFeatureData } from '../environment';
import { clearRecords, countRecords } from '../environment/foreground/featureDb';
import { FEATURE_STORES } from './featureStores';
import type { FeatureStoreId } from './featureStores';

export type StoreInfo = {|
	id: FeatureStoreId,
	name: string,
	count: number,
	cap: ?number,
	available: boolean,
	// A set keyed by account is purged from the saved-content manager, one
	// account at a time. A single button here would wipe every account on the
	// machine, which is not what "purge" reads as next to a total.
	purgeable: boolean,
|};

// The ceiling each set prunes itself down to, where it has one. The emoji cache
// is capped by `CACHE_CAP` in `subredditEmotes.js`; the other two read theirs
// from a module option, so this is the default rather than the live value.
const STORE_CAPS: { [FeatureStoreId]: ?number } = {
	voteHistory: 50000,
	mediaManifest: 20000,
	savedContent: null,
	subredditEmotes: 250,
};

export async function getStoreInfos(): Promise<StoreInfo[]> {
	const results: StoreInfo[] = [];
	for (const descriptor of FEATURE_STORES) {
		// The database is the extension's now, which a private window shares with
		// the normal one. Reading it from a private window would report the counts
		// of browsing this window is not supposed to see.
		const available = canPersistFeatureData(descriptor.featureId);
		let count = 0;
		if (available) {
			// One message per set, in order: four in flight would not make the
			// background answer any sooner, and the rows render together anyway.
			// eslint-disable-next-line no-await-in-loop
			try { count = await countRecords(descriptor.id); } catch { count = 0; }
		}
		results.push({
			id: descriptor.id,
			name: descriptor.label,
			count,
			cap: STORE_CAPS[descriptor.id],
			available,
			purgeable: available && !descriptor.accountScoped,
		});
	}
	return results;
}

export function clearStore(info: StoreInfo): Promise<number> {
	if (!info.purgeable) return Promise.resolve(0);
	return clearRecords(info.id);
}

export function formatCount(info: StoreInfo): string {
	if (!info.available) return `${info.name}: not available in a private window`;
	const pct = info.cap ? ` (${Math.round(info.count / info.cap * 100)}%)` : '';
	return `${info.name}: ${info.count.toLocaleString()}${info.cap ? ` / ${info.cap.toLocaleString()}${pct}` : ''}`;
}
