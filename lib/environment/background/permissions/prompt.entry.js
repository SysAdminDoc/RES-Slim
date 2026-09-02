/* @flow */

// Call chrome.permissions.request directly here; do not route through the
// background's handleMessage. The background path has a `.catch(() =>
// makePromptWindow(...))` fallback for the service-worker context where the
// API isn't available; if this prompt page were to use that path and the
// underlying call rejected for any reason (denied perms, lost user gesture,
// invalid origin pattern), the catch would open another prompt window,
// which the user would click, which would open another, ad infinitum.
// The prompt page is the foreground context that the background was trying
// to reach, so it must invoke the API directly and report a definitive
// true/false result back to the opener.

import {
	SETTINGS_THEME_STORAGE_KEY,
	getSettingsThemeAccent,
	getSettingsThemeMetaColor,
	resolveSettingsTheme,
} from '../../../constants/settingsThemes';

// This page is served from the same extension origin as the settings console, so
// it can read the theme the user actually chose rather than always painting
// itself graphite blue. Only the accent is adopted: the prompt's surfaces are
// neutral dark and stay legible under every preset, and its text tokens are
// unchanged, so there is no contrast to re-verify per theme.
function applyStoredTheme() {
	let stored = null;
	try {
		stored = localStorage.getItem(SETTINGS_THEME_STORAGE_KEY);
	} catch (e) {
		// Storage can be unavailable (private mode, blocked cookies); the CSS
		// defaults already cover that case.
		return;
	}
	// Resolved, not normalized: the stored value can be `system`, and this page
	// is a one-shot window with no reason to follow a scheme change mid-prompt.
	const theme = resolveSettingsTheme(stored);
	const root = document.documentElement;
	root.dataset.settingsTheme = theme;
	root.style.setProperty('--prompt-accent', getSettingsThemeAccent(theme));
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', getSettingsThemeMetaColor(theme));
}

applyStoredTheme();

const url = new URL(location.href);
let reported = false;
let promptInputIsValid = true;

function reportResult(result) {
	if (reported) return;
	reported = true;
	url.searchParams.set('result', JSON.stringify(result));
	location.href = url.href;
}

function parseJsonArrayParameter(name: string): Array<string> {
	const rawValue = url.searchParams.get(name);
	if (!rawValue) return [];

	try {
		const value = JSON.parse(rawValue);
		if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
			return value;
		}
	} catch (e) {
		console.error(`Invalid permissions prompt parameter "${name}":`, e);
		promptInputIsValid = false;
		return [];
	}

	console.error(`Invalid permissions prompt parameter "${name}": expected an array of strings.`);
	promptInputIsValid = false;
	return [];
}

const permissions = parseJsonArrayParameter('permissions');
const origins = parseJsonArrayParameter('origins');
const button = document.body.querySelector('#request');
const summary = document.body.querySelector('#permissionSummary');
const status = document.body.querySelector('#permissionStatus');

function setPromptStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral') {
	if (!(status instanceof HTMLElement)) return;
	status.hidden = false;
	status.textContent = message;
	status.classList.toggle('is-success', tone === 'success');
	status.classList.toggle('is-error', tone === 'error');
}

function setButtonBusy(busy: boolean) {
	if (!(button instanceof HTMLButtonElement)) return;
	button.disabled = busy;
	button.setAttribute('aria-busy', busy ? 'true' : 'false');
	button.textContent = busy ? 'Requesting access…' : 'Grant access';
}

// This screen asks for trust, so it has to say what it is asking for in words
// rather than echoing a raw host-permission pattern at the reader.
const PERMISSION_LABELS = {
	downloads: 'Save files to your downloads folder',
	history: 'Read your browsing history',
	tabs: 'See the tabs you have open',
	storage: 'Store settings in this browser',
	scripting: 'Run RES-Slim code on reddit pages',
	unlimitedStorage: 'Store more than the default amount of data locally',
};

function describePermission(name: string): string {
	return PERMISSION_LABELS[name] || name;
}

function describeOrigin(pattern: string): string {
	try {
		// Host patterns are not valid URLs because of the wildcard, so read the
		// host out directly and fall back to the raw pattern if it is unusual.
		const match = /^[a-z-]+:\/\/([^/]+)/.exec(pattern);
		if (!match) return pattern;
		const host = match[1].replace(/^\*\./, '');
		return host === '*' ? pattern : `Contact ${host}`;
	} catch (e) {
		return pattern;
	}
}

function finishPrompt(result: boolean) {
	if (button instanceof HTMLButtonElement) {
		button.disabled = true;
		button.removeAttribute('aria-busy');
		button.textContent = result ? 'Access granted' : 'Access not granted';
	}
	const grantedMessage = 'Access granted. Returning to RES-Slim…';
	const deniedMessage = 'Access was not granted. Returning to RES-Slim. The feature that asked for it stays off, and everything else keeps working.';
	setPromptStatus(result ? grantedMessage : deniedMessage, result ? 'success' : 'error');
	setTimeout(() => reportResult(result), 350);
}

function renderPermissionSummary() {
	if (!(summary instanceof HTMLElement)) return;
	const items = [...permissions, ...origins];
	if (!items.length) return;

	summary.classList.add('has-items');
	const title = document.createElement('div');
	title.className = 'permissionListTitle';
	title.textContent = 'Requested access';
	const list = document.createElement('ul');
	for (const permission of permissions) {
		const listItem = document.createElement('li');
		listItem.textContent = describePermission(permission);
		list.append(listItem);
	}
	for (const origin of origins) {
		const listItem = document.createElement('li');
		listItem.textContent = describeOrigin(origin);
		// The exact pattern is still available for anyone who wants it.
		listItem.title = origin;
		list.append(listItem);
	}
	summary.replaceChildren(title, list);
}

renderPermissionSummary();

if (!(button instanceof HTMLButtonElement)) {
	console.error('Permissions prompt is missing the request button.');
	reportResult(false);
} else if (!promptInputIsValid) {
	reportResult(false);
} else if (!permissions.length && !origins.length) {
	reportResult(false);
} else {
	// Callback first, promise second, because the two browsers this ships to do
	// not agree and getting it wrong is silent. Chrome MV3 returns a promise and
	// also accepts a callback. Firefox's `chrome` namespace is the callback-style
	// alias — `browser` is the promise one — so `await chrome.permissions.request(…)`
	// there resolves to `undefined`, `Boolean(undefined)` is false, and **every
	// grant is reported to the opener as a denial** while the tab closes normally.
	// That is the exact wrong-property failure this prompt exists to avoid, on the
	// exact browser the tab-instead-of-popup change was made for.
	//
	// Whichever arrives first wins; the other never settles, which is harmless.
	function requestPermissions() {
		return new Promise((resolve, reject) => {
			let returned;
			try {
				returned = chrome.permissions.request({ permissions, origins }, result => {
					if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
					else resolve(result);
				});
			} catch (e) {
				reject(e);
				return;
			}
			if (returned && typeof returned.then === 'function') returned.then(resolve, reject);
		});
	}

	button.addEventListener('click', async () => {
		setButtonBusy(true);
		setPromptStatus('Waiting for your browser\'s permission prompt…');
		try {
			const granted = await requestPermissions();
			finishPrompt(Boolean(granted));
		} catch (e) {
			// Surface the failure once, then resolve as false so the opener stops
			// waiting and the prompt window closes. Never reopen it from here.
			console.error('chrome.permissions.request failed:', e);
			finishPrompt(false);
		}
	});

	// Focus, so pressing space / enter can be used as an alternative to clicking the button.
	button.focus();
}
