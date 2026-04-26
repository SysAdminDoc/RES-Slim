/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';

addListener('permissions', handleMessage);

const containsPermissions = apiToPromise((details, callback) => chrome.permissions.contains(details, callback));
const requestPermissions = apiToPromise((details, callback) => chrome.permissions.request(details, callback));
const getCurrentWindow = apiToPromise(callback => chrome.windows.getCurrent(callback));
const createWindow = apiToPromise((details, callback) => chrome.windows.create(details, callback));
const removeTab = apiToPromise((tabId, callback) => chrome.tabs.remove(tabId, callback));

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

	const width = 630;
	const height = 255;

	// Get the current window's dimensions and calculate center position
	const { width: screenWidth, height: screenHeight } = await getCurrentWindow().catch(() => null) || { width: 1920, height: 1080 };
	const left = Math.floor(screenWidth / 2 - width / 2);
	const top = Math.floor(screenHeight / 2 - height / 2);

	const createdWindow = await createWindow({ url: url.href, type: 'popup', width, height, left, top });
	const id = createdWindow && createdWindow.tabs && createdWindow.tabs[0] && createdWindow.tabs[0].id;
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
