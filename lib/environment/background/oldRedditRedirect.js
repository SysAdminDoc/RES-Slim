/* @flow */
// Keep the opt-in old-Reddit redirect in Chromium/Firefox's request layer so
// www.reddit.com never has to download or render before the host is replaced.

import { apiToPromise } from '../utils/api';
import {
	OLD_REDDIT_DYNAMIC_RULE_IDS,
	buildOldRedditRedirectRules,
	storedAutoRedirectEnabled,
} from '../../utils/oldRedditRedirect';

const OPTIONS_KEY = 'RESoptions.oldRedditRedirect';
const MODULE_PREFS_KEY = 'RES.modulePrefs';

const getLocal = apiToPromise((keys, callback) => chrome.storage.local.get(keys, callback));
const updateDynamicRules = apiToPromise((options, callback) => chrome.declarativeNetRequest.updateDynamicRules(options, callback));

export async function syncOldRedditRedirectRule(): Promise<void> {
	const values = await getLocal([OPTIONS_KEY, MODULE_PREFS_KEY]);
	const enabled = storedAutoRedirectEnabled(values || {});
	await updateDynamicRules({
		removeRuleIds: Array.from(OLD_REDDIT_DYNAMIC_RULE_IDS),
		...(enabled ? { addRules: buildOldRedditRedirectRules() } : {}),
	});
}

let syncQueue: Promise<void> = Promise.resolve();

function scheduleSync() {
	syncQueue = syncQueue
		.catch(() => {})
		.then(syncOldRedditRedirectRule)
		.catch(error => {
			console.error('[RES-Slim] Could not update the Old Reddit redirect rule:', error);
		});
}

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local') return;
	if (!changes[OPTIONS_KEY] && !changes[MODULE_PREFS_KEY]) return;
	scheduleSync();
});

// Dynamic rules persist, but re-syncing on worker startup also refreshes rule
// definitions after an extension update and removes stale rules when disabled.
scheduleSync();
