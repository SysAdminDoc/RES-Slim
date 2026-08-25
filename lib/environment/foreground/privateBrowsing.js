/* @flow */

export type FeatureDataStoreId =
	| 'authorContextBadge'
	| 'commentHidePersistor'
	| 'commentHighlights'
	| 'dragResize'
	| 'hideAll'
	| 'mediaArchiveManifest'
	| 'mediaVolume'
	| 'newCommentCountSubscriptions'
	| 'newCommentCountVisits'
	| 'notifications'
	| 'penaltyBox'
	| 'perSubSort'
	| 'readComments'
	| 'savedBackup'
	| 'saveComments'
	| 'storageMaintenance'
	| 'subredditEmotes'
	| 'userTagger'
	| 'versionLifecycle'
	| 'visitedLinks'
	| 'visitedPosts'
	| 'voteHistory';

export type PrivateContextPolicy = 'allow' | 'block';

// Every module-owned persistent data store is named here. `allow` preserves
// private-window behavior for settings and lifecycle state; `block` is for
// browsing activity or user content that must not escape a private context.
export const FEATURE_DATA_STORE_POLICIES: { [string]: PrivateContextPolicy } = Object.freeze({
	authorContextBadge: 'allow',
	commentHidePersistor: 'allow',
	commentHighlights: 'allow',
	dragResize: 'allow',
	hideAll: 'allow',
	mediaArchiveManifest: 'block',
	mediaVolume: 'allow',
	newCommentCountSubscriptions: 'allow',
	newCommentCountVisits: 'block',
	notifications: 'allow',
	penaltyBox: 'allow',
	perSubSort: 'allow',
	readComments: 'block',
	savedBackup: 'block',
	saveComments: 'allow',
	storageMaintenance: 'allow',
	subredditEmotes: 'block',
	userTagger: 'block',
	versionLifecycle: 'allow',
	visitedLinks: 'block',
	visitedPosts: 'block',
	voteHistory: 'block',
});

export function isPrivateBrowsing(): boolean {
	return chrome.extension.inIncognitoContext;
}

export function canPersistFeatureData(storeId: FeatureDataStoreId, allowPrivate: boolean = false): boolean {
	if (!Object.hasOwn(FEATURE_DATA_STORE_POLICIES, storeId)) {
		throw new Error(`Feature data store "${storeId}" does not declare a private-context policy`);
	}
	const policy = FEATURE_DATA_STORE_POLICIES[storeId];
	return policy === 'allow' || allowPrivate || !isPrivateBrowsing();
}

export function guardFeatureDataMutation<T>(
	storeId: FeatureDataStoreId,
	mutation: () => Promise<T>,
	blockedValue: T,
	allowPrivate: boolean = false,
): Promise<T> {
	if (!canPersistFeatureData(storeId, allowPrivate)) return Promise.resolve(blockedValue);
	return mutation();
}
