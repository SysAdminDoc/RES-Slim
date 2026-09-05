/* @flow */
// The local data sets this extension keeps in IndexedDB, described once.
//
// They used to live in reddit.com's own storage, because the code that wrote
// them is a content script and a content script's `indexedDB` is the page's.
// That put the data behind the site: the settings page is served from the
// extension's origin, so it could not read a single record, and every browse,
// export, and purge control had to be a panel injected into old Reddit. If
// Reddit was unreachable, so was your own vote log.
//
// One database in the extension's origin fixes that. The background page owns
// it, content scripts reach it over the message bridge, and the settings page
// reads it directly. `legacy` is where each set used to live, so the first
// Reddit page load after the upgrade can copy it across.

import type { FeatureDataStoreId } from '../environment/foreground/privateBrowsing';

export const UNASSIGNED_SAVED_ACCOUNT = '<unassigned>';

export type FeatureStoreId = 'voteHistory' | 'mediaManifest' | 'savedContent' | 'subredditEmotes';

export type FeatureStoreIndex = {|
	name: string,
	keyPath: string | Array<string>,
|};

export type FeatureStoreDescriptor = {|
	id: FeatureStoreId,
	// The `canPersistFeatureData` policy that governs the set. Not always the
	// store id: the media manifest's policy is named after its module.
	featureId: FeatureDataStoreId,
	label: string,
	keyPath: string | Array<string>,
	indexes: Array<FeatureStoreIndex>,
	// True where records belong to a named Reddit account. Such a set has no
	// meaningful whole-store purge: wiping it would take every account's data
	// on a machine that may be shared, so the purge is offered per account.
	accountScoped: boolean,
	legacy: {|
		dbName: string,
		storeName: string,
		// The store this set lived in one schema earlier, if it moved. Saved
		// content is the only one: v1 kept no account name, so a record copied
		// out of it is stamped with `legacyDefaults` rather than attributed to
		// whoever happens to be signed in during the upgrade.
		altStoreName?: string,
		legacyDefaults?: { [string]: mixed },
	|},
|};

export const FEATURE_DB_NAME = 'rsm-featureData';
export const FEATURE_DB_VERSION = 1;

export const FEATURE_STORES: Array<FeatureStoreDescriptor> = [
	{
		id: 'voteHistory',
		featureId: 'voteHistory',
		label: 'Vote history',
		keyPath: 'id',
		accountScoped: false,
		indexes: [
			{ name: 'timestamp', keyPath: 'timestamp' },
			{ name: 'subreddit', keyPath: 'subreddit' },
			{ name: 'author', keyPath: 'author' },
		],
		legacy: { dbName: 'rsm-voteHistory', storeName: 'votes' },
	},
	{
		id: 'mediaManifest',
		featureId: 'mediaArchiveManifest',
		label: 'Media history',
		keyPath: 'id',
		accountScoped: false,
		indexes: [
			{ name: 'timestamp', keyPath: 'timestamp' },
			{ name: 'source', keyPath: 'source' },
			{ name: 'subreddit', keyPath: 'subreddit' },
		],
		legacy: { dbName: 'rsm-mediaManifest', storeName: 'entries' },
	},
	{
		id: 'savedContent',
		featureId: 'savedBackup',
		label: 'Saved content',
		keyPath: ['username', 'fullname'],
		accountScoped: true,
		indexes: [
			{ name: 'username', keyPath: 'username' },
			{ name: 'usernameCreatedUtc', keyPath: ['username', 'createdUtc'] },
		],
		legacy: { dbName: 'rsm-savedContent', storeName: 'accountItems', altStoreName: 'items', legacyDefaults: { username: UNASSIGNED_SAVED_ACCOUNT } },
	},
	{
		id: 'subredditEmotes',
		featureId: 'subredditEmotes',
		label: 'Subreddit emoji cache',
		keyPath: 'subreddit',
		accountScoped: false,
		indexes: [
			{ name: 'fetchedAt', keyPath: 'fetchedAt' },
		],
		legacy: { dbName: 'rsm-subredditEmotes', storeName: 'maps' },
	},
];

export function getFeatureStore(id: mixed): FeatureStoreDescriptor {
	const found = FEATURE_STORES.find(store => store.id === id);
	if (!found) throw new Error(`Unknown feature data store: ${String(id)}`);
	return found;
}

// The key of a record, read the way IndexedDB would read it. Deleting by key
// and counting a partition both need this on the side that has the record but
// not the store.
export function featureStoreKey(descriptor: FeatureStoreDescriptor, record: mixed): mixed {
	if (!record || typeof record !== 'object') throw new Error(`A ${descriptor.id} record must be an object`);
	const read = (path: string) => {
		const value = (record: any)[path];
		if (value === undefined) throw new Error(`A ${descriptor.id} record is missing its "${path}" key`);
		return value;
	};
	return Array.isArray(descriptor.keyPath) ? descriptor.keyPath.map(read) : read(descriptor.keyPath);
}

// There is no automatic update here: the README's only upgrade path is pull,
// rebuild, reload, which makes rolling back to an earlier tag the documented way
// to recover from a bad build. So a profile whose `rsm-featureData` was written
// by a newer `FEATURE_DB_VERSION` meeting an older build is an ordinary thing to
// do, not a corner case — and IndexedDB answers that with a bare `VersionError`.
// Every feature store then rejects at once, so user tags, vote history, saved
// content, the media manifest and visited posts all go blank together, which
// looks exactly like the data being gone.
//
// It is not gone. The database refused to open; nothing was read and nothing was
// written. Saying so is the whole of this function.
export function describeOpenFailure(error: ?Error): Error {
	if (error && error.name === 'VersionError') {
		return new Error(
			`This copy of RES-Slim is older than the local data it found. Its feature database is at version ${FEATURE_DB_VERSION}, ` +
			'and the one in this browser profile was written by a newer build. Nothing has been read or changed and none of your ' +
			'tags, vote history, saved content or visited posts have been lost — they need the newer build to open them. ' +
			'Pull and rebuild, or reload the newer version you had before.',
		);
	}
	return error || new Error('Could not open the feature database');
}
