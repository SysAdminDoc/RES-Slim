/* @flow */

// Records that this profile installed the extension, so the foreground can greet
// once and then stop.
//
// Lives in `lib/environment/` because that is where direct `chrome.*` access
// belongs — `lib/environment/.eslintrc.json` is the only place declaring the
// `webextensions` env, which is how the first draft of this, written into
// `background.entry.js`, was caught reaching outside the boundary.
//
// `onInstalled` is the only honest signal for a fresh install. The first attempt
// inferred it from an empty local store and could never fire, because `migrate()`
// writes keys before the first page has finished loading — invisible to a unit
// test on the predicate, obvious the moment the extension was driven.

import { shouldAnnounceUpdate } from '../../utils/firstRun';

export const PENDING_GREETING_KEY = 'RESmodules.version.pendingGreeting';
export const PENDING_UPDATE_KEY = 'RESmodules.version.pendingUpdate';

chrome.runtime.onInstalled.addListener(details => {
	// `onInstalled` also fires with reason 'update' and 'chrome_update', on every
	// release, for every existing user. Only a genuine install is a first run.
	if (details.reason === 'install') {
		chrome.storage.local.set({ [PENDING_GREETING_KEY]: true });
		return;
	}

	// `chrome_update` is the browser updating, not us; it carries no
	// `previousVersion` and means nothing about this extension changed.
	if (details.reason !== 'update') return;

	// The version pair is recorded here because this is the only moment either
	// half is knowable. `previousVersion` exists nowhere else, and by the time a
	// content script runs the manifest reports only the new one.
	const currentVersion = chrome.runtime.getManifest().version;
	if (!shouldAnnounceUpdate(details.previousVersion, currentVersion)) return;
	chrome.storage.local.set({
		[PENDING_UPDATE_KEY]: { previousVersion: details.previousVersion, currentVersion },
	});
});
