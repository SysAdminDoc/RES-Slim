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

export const PENDING_GREETING_KEY = 'RESmodules.version.pendingGreeting';

chrome.runtime.onInstalled.addListener(details => {
	// `onInstalled` also fires with reason 'update' and 'chrome_update', on every
	// release, for every existing user. Only a genuine install is a first run.
	if (details.reason !== 'install') return;
	chrome.storage.local.set({ [PENDING_GREETING_KEY]: true });
});
