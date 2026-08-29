/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';

addListener('permissions', handleMessage);

const containsPermissions = apiToPromise((details, callback) => chrome.permissions.contains(details, callback));
const requestPermissions = apiToPromise((details, callback) => chrome.permissions.request(details, callback));
const getCurrentWindow = apiToPromise(callback => chrome.windows.getCurrent(callback));
const createWindow = apiToPromise((details, callback) => chrome.windows.create(details, callback));
const createTab = apiToPromise((details, callback) => chrome.tabs.create(details, callback));
const removeTab = apiToPromise((tabId, callback) => chrome.tabs.remove(tabId, callback));

const PROMPT_WIDTH = 640;
const PROMPT_HEIGHT = 560;

// Where the prompt page is opened, which is not a cosmetic choice.
//
// Firefox refuses `permissions.request()` when the calling document lives in an
// extension popup window — Mozilla Bug 1957822, still open, and the exact
// topology this used on every browser. The request rejects, so the user is shown
// a window that cannot do the one thing it exists for. Upstream RES issue 5530
// is the same failure reported from the other end.
//
// A normal tab is a browsing context Firefox is willing to raise its own
// permission panel from. Chrome keeps the popup window: it works there, it is
// less disruptive than taking over a tab, and changing it would be a UX change
// made for another browser's bug.
//
// Both paths return a tab id, because everything after this — watching for the
// result and closing exactly one thing — is written against tabs.
async function openPromptSurface(url: string): Promise<number | null> {
	if (process.env.BUILD_TARGET === 'firefox') {
		const tab = await createTab({ url, active: true });
		return tab && typeof tab.id === 'number' ? tab.id : null;
	}

	// Centred on the current window, falling back to a common desktop size when
	// there is no window to measure.
	const { width: screenWidth, height: screenHeight } = await getCurrentWindow().catch(() => null) || { width: 1920, height: 1080 };
	const left = Math.floor(screenWidth / 2 - PROMPT_WIDTH / 2);
	const top = Math.floor(screenHeight / 2 - PROMPT_HEIGHT / 2);

	const createdWindow = await createWindow({ url, type: 'popup', width: PROMPT_WIDTH, height: PROMPT_HEIGHT, left, top });
	const id = createdWindow && createdWindow.tabs && createdWindow.tabs[0] && createdWindow.tabs[0].id;
	return typeof id === 'number' ? id : null;
}

export function handleMessage({ operation, permissions, origins }: *) {
	switch (operation) {
		case 'contains':
			return containsPermissions({ permissions, origins });
		case 'request':
			return requestPermissions({ permissions, origins })
				.catch(() => makePromptWindow({ permissions, origins }));
		default:
			throw new Error(`Invalid permissions operation: ${operation}`);
	}
}

async function makePromptWindow({ permissions, origins }) {
	const url = new URL('prompt.html', location.origin);
	url.searchParams.set('permissions', JSON.stringify(permissions));
	url.searchParams.set('origins', JSON.stringify(origins));

	const id = await openPromptSurface(url.href);
	if (typeof id !== 'number') return false;

	return new Promise(resolve => {
		function finish(result, closeTab = false) {
			stopListening();
			resolve(Boolean(result));
			if (closeTab) removeTab(id).catch(() => {});
		}

		function updateListener(tabId, updates) {
			if (tabId !== id) return;

			let updatedUrl;
			try {
				updatedUrl = updates.url && new URL(updates.url);
			} catch (e) {
				return;
			}
			if (updatedUrl && updatedUrl.searchParams.has('result')) {
				let result = false;
				try {
					result = JSON.parse(updatedUrl.searchParams.get('result') || 'false');
				} catch (e) {
					console.error('RES-Slim: malformed permission prompt result.', e);
				}
				finish(result, true);
			}
		}

		function removeListener(tabId) {
			if (tabId !== id) return;
			finish(false);
		}

		function stopListening() {
			chrome.tabs.onUpdated.removeListener(updateListener);
			chrome.tabs.onRemoved.removeListener(removeListener);
		}

		chrome.tabs.onUpdated.addListener(updateListener);
		chrome.tabs.onRemoved.addListener(removeListener);
	});
}
