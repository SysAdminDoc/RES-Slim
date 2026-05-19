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
		console.error(`Invalid permissions prompt parameter "${name}":`, e); // eslint-disable-line no-console
		promptInputIsValid = false;
		return [];
	}

	console.error(`Invalid permissions prompt parameter "${name}": expected an array of strings.`); // eslint-disable-line no-console
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
	button.textContent = busy ? 'Requesting access...' : 'Grant access';
}

function finishPrompt(result: boolean) {
	if (button instanceof HTMLButtonElement) {
		button.disabled = true;
		button.removeAttribute('aria-busy');
		button.textContent = result ? 'Access granted' : 'Access not granted';
	}
	setPromptStatus(
		result ? 'Access granted. Returning to RES-Slim...' : 'Access was not granted. Returning to RES-Slim without enabling this permission.',
		result ? 'success' : 'error',
	);
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
	for (const item of items) {
		const listItem = document.createElement('li');
		listItem.textContent = item;
		list.append(listItem);
	}
	summary.replaceChildren(title, list);
}

renderPermissionSummary();

if (!(button instanceof HTMLButtonElement)) {
	console.error('Permissions prompt is missing the request button.'); // eslint-disable-line no-console
	reportResult(false);
} else if (!promptInputIsValid) {
	reportResult(false);
} else if (!permissions.length && !origins.length) {
	reportResult(false);
} else {
	button.addEventListener('click', async () => {
		setButtonBusy(true);
		setPromptStatus('Waiting for your browser permission prompt...');
		try {
			const granted = await chrome.permissions.request({ permissions, origins });
			finishPrompt(Boolean(granted));
		} catch (e) {
			// Surface the failure once, then resolve as false so the opener stops
			// waiting and the prompt window closes. Never reopen it from here.
			console.error('chrome.permissions.request failed:', e); // eslint-disable-line no-console
			finishPrompt(false);
		}
	});

	// Focus, so pressing space / enter can be used as an alternative to clicking the button.
	button.focus();
}
