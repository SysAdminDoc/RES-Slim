/* @flow */
// Keep the opt-in old-Reddit redirect in Chromium/Firefox's request layer so
// www.reddit.com never has to download or render before the host is replaced.

import { apiToPromise } from '../utils/api';
import {
	HOST_ESCAPE_RULE_ID,
	OLD_REDDIT_DYNAMIC_RULE_IDS,
	buildHostEscapeRule,
	buildOldRedditRedirectRules,
	storedAutoRedirectEnabled,
} from '../../utils/oldRedditRedirect';
import { addListener } from './messaging';

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

// One tab asking to stay on current Reddit, or leaving. The escape lives in the
// session rule's own `tabIds`, which is read back rather than mirrored in a map:
// session rules outlive the service worker, and a map would not.
//
// Not every target has session rules - firefox's MV2 build has no
// `updateSessionRules`. There the content script's `sessionStorage` half carries
// the escape on its own, which is the whole mechanism anywhere the redirect is a
// foreground fallback rather than a request rule.
async function setTabEscape(tabId: number, enabled: boolean): Promise<void> {
	const dnr = chrome.declarativeNetRequest;
	if (!dnr || typeof dnr.updateSessionRules !== 'function' || typeof dnr.getSessionRules !== 'function') return;

	const rules = await dnr.getSessionRules();
	const existing = rules.find(rule => rule.id === HOST_ESCAPE_RULE_ID);
	const tabIds = new Set(existing && existing.condition && Array.isArray(existing.condition.tabIds) ? existing.condition.tabIds : []);

	const before = tabIds.size;
	if (enabled) tabIds.add(tabId);
	else tabIds.delete(tabId);
	// Every www.reddit.com document re-asserts the escape, so most calls change
	// nothing and must not rewrite the rule.
	if (tabIds.size === before) return;

	await dnr.updateSessionRules({
		removeRuleIds: [HOST_ESCAPE_RULE_ID],
		...(tabIds.size ? { addRules: [buildHostEscapeRule([...tabIds])] } : {}),
	});
}

let syncQueue: Promise<void> = Promise.resolve();

// Every rule write goes through the one queue. `setTabEscape` reads the rules
// back before writing them, so two running at once would lose a tab.
function enqueue(work: () => Promise<void>): Promise<void> {
	syncQueue = syncQueue.catch(() => {}).then(work).catch(error => {
		console.error('[RES-Slim] Could not update the Old Reddit redirect rule:', error);
	});
	return syncQueue;
}

addListener('oldRedditHostEscape', ({ enabled }: { enabled: boolean }, { tab }: any) => {
	// Only the background knows which tab a content script speaks for, which is
	// the whole reason this is a message and not a decision the page can make.
	if (!tab || typeof tab.id !== 'number') return false;
	return enqueue(() => setTabEscape(tab.id, enabled === true)).then(() => true);
});

if (chrome.tabs && chrome.tabs.onRemoved) {
	chrome.tabs.onRemoved.addListener(tabId => { enqueue(() => setTabEscape(tabId, false)); });
}

function scheduleSync() {
	enqueue(syncOldRedditRedirectRule);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local') return;
	if (!changes[OPTIONS_KEY] && !changes[MODULE_PREFS_KEY]) return;
	scheduleSync();
});

// Dynamic rules persist, but re-syncing on worker startup also refreshes rule
// definitions after an extension update and removes stale rules when disabled.
scheduleSync();
