/* @flow */

import { RES_SETTINGS_HASH } from '../constants/urlHashes';
import { context, isOptionsPage, getOptionsURL, i18n, openNewTab } from '../environment';
import { escapeHTML, string } from '../utils';
import { appType, pageType } from '../utils/currentLocation';
import { getModuleSummary } from '../utils/profiling';
import { describeRenderer } from '../utils/selectorDrift';
import { Module } from '../core/module';
import * as Modules from '../core/modules';
import * as Menu from '../modules/menu';

export const module: Module<{ [string]: any }> = new Module('settingsNavigation');

module.moduleName = 'settingsNavName';
module.category = 'coreCategory';
module.description = 'settingsNavDesc';
module.hidden = true;
module.alwaysEnabled = true;
module.options = {
	showAllOptions: {
		title: 'settingsNavigationShowAllOptionsTitle',
		type: 'boolean',
		value: true,
		description: 'settingsNavigationShowAllOptionsDesc',
		noconfig: true,
	},
};

module.beforeLoad = () => {
	Menu.addMenuItem(
		() => string.html`<div id="SettingsConsole">
			${i18n('RESSettingsConsole')}
			<span module="search" class="RESMenuItemButton res-icon" title="search settings">\uF094</span>
		</div>`,
		e => open(e.target.getAttribute('module')),
		-10,
	);
};

module.contentStart = () => {
	window.addEventListener('popstate', () => { update(); });
	update();

	// Open settings links (regardless of hostname)
	document.body.addEventListener('click', (e: MouseEvent) => {
		if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // Respect modified clicks
		const anchor = e.target instanceof Element ? e.target.closest('a') : null;
		if (!(anchor instanceof HTMLAnchorElement)) return;
		if (anchor.target && anchor.target.includes('_blank')) return;
		const url = new URL(anchor.href, location.origin);
		if (url && isSettingsUrl(url.href)) {
			update(url);
			e.stopImmediatePropagation();
			e.preventDefault();
		}
	}, true);
};

export function makeUrlHashLink(moduleID: string, optionKey?: string, displayText?: string, cssClass?: string): string {
	const mod = Modules.getUnchecked(moduleID);
	if (!displayText) {
		if (mod && optionKey) {
			displayText = i18n(mod.options[optionKey].title);
		} else if (mod) {
			displayText = i18n(mod.moduleName);
		} else {
			displayText = 'Settings';
		}
	}

	let title = ['RES Settings'];
	if (mod) {
		title.push(i18n(mod.moduleName));
	}
	if (optionKey) {
		title.push(optionKey);
	}
	title = title.join(' &gt; ');

	const hash = makeUrlHash(moduleID, optionKey);
	// Every interpolation is escaped. Both callers wrap the result in
	// `string.safe()`, so whatever this returns is trusted as markup and inserted
	// into reddit's own pages — `displayText`, `cssClass` and the `optionKey`
	// inside `title` were all going in raw. `title` is assembled from escaped
	// pieces above and joined with a literal `&gt;`, so it is already safe.
	return `<a class="${escapeHTML(cssClass || '')}" href="${escapeHTML(hash)}" title="${title}">${escapeHTML(displayText)}</a>`;
}

// The settings prefix must be followed by `/` or end-of-string.
//
// Without this, `#res:settings-redirect-standalone-options-page/accountSwitcher`
// — a separate route that merely starts with the same literal — reads as a
// settings URL. `parseHash` grew the check in v0.3.8 but `isSettingsUrl` did not,
// so the click handler intercepted that route and then parsed no module out of
// it, swallowing the navigation. Shared here so the two cannot drift again.
function isSettingsHash(hash: string): boolean {
	for (const prefix of [RES_SETTINGS_HASH, '#!settings' /* legacy */]) {
		if (!hash.startsWith(prefix)) continue;
		const rest = hash.slice(prefix.length);
		if (!rest || rest.startsWith('/')) return true;
	}
	return false;
}

export function parseHash(hash: string) {
	const normalizedHash = hash.startsWith('#!settings') ?
		hash.replace(/^#!settings/, RES_SETTINGS_HASH) :
		hash;
	if (!isSettingsHash(normalizedHash)) {
		return {
			moduleID: undefined,
			optionKey: undefined,
		};
	}

	const path = normalizedHash.slice(RES_SETTINGS_HASH.length).replace(/^\/+/, '');
	const params = path ? path.split('/').map(part => decodeURIComponent(part)) : [];
	return {
		moduleID: params[0] || undefined,
		optionKey: params[1] || undefined,
	};
}

export function makeUrlHash(moduleID?: string, optionKey?: string): string {
	const hashComponents = [RES_SETTINGS_HASH];

	if (moduleID) {
		hashComponents.push(encodeURIComponent(moduleID));
	}

	if (moduleID && optionKey) {
		hashComponents.push(encodeURIComponent(optionKey));
	}

	return hashComponents.join('/');
}

export function isSettingsUrl(href: string): boolean {
	const { origin, hash } = new URL(href, location.origin);

	const sameSite = origin === getOptionsURL().origin ||
		origin.split('.').slice(-2).join('.') === context.origin.split('.').slice(-2).join('.');
	if (!sameSite) return false;

	return isSettingsHash(hash);
}

export function setHash(hash: string) {
	if (window.top === window) {
		if (parseHash(location.hash).moduleID === parseHash(hash).moduleID) {
			history.replaceState(null, '', hash);
		} else {
			history.pushState(null, '', hash);
		}
	} else {
		window.parent.postMessage({ hash }, '*');
	}
}

let iframe;

export function update(url: { href: string, hash: string } = location) {
	if (isSettingsUrl(url.href)) {
		const { moduleID, optionKey } = parseHash(url.hash);
		open(moduleID, optionKey);
	} else if (iframe) {
		iframe.contentWindow.postMessage({ close: true }, '*');
	}
}

// The module timings are measured here, in the content script, and the console
// that wants to show them is a different document. Rather than persist a
// snapshot on every page load — which would mean collecting diagnostics whether
// anyone ever asks for them — the console asks, and this answers.
//
// The reply carries module ids and durations and nothing else: no URL, no
// subreddit, no account. It is still addressed to the options origin rather than
// `'*'`, because we know exactly who asked.
function sendDiagnostics(source: ?any) {
	const target = source || (iframe && iframe.contentWindow);
	if (!target) return;
	try {
		target.postMessage({
			diagnostics: {
				renderer: describeRenderer(appType()) || appType(),
				pageType: pageType() || null,
				timings: getModuleSummary(),
			},
		}, getOptionsURL().origin);
	} catch (e) {
		// A console that navigated away between asking and being answered is not
		// an error worth surfacing; the request times out on its side.
		console.warn('RES-Slim: could not answer the console diagnostics request', e);
	}
}

function listener({ origin, data, source }: MessageEvent) {
	if (origin !== getOptionsURL().origin) return;
	const { failedToLoad, hash, closing, requestDiagnostics } = (data: any);
	if (failedToLoad) handleEmbedFailure();
	if (hash) setHash(hash);
	if (closing) close();
	if (requestDiagnostics) sendDiagnostics(source);
}

// Set by `progressListener` and read by the fallback timer armed on each frame
// load. Module scope rather than a closure per load, so there is one listener
// for the life of an open console instead of one per navigation inside it.
let embedProgressed = false;

function progressListener({ origin, data }: MessageEvent) {
	if (origin === getOptionsURL().origin && (data: any).loadSuccess) embedProgressed = true;
}

function handleEmbedFailure() {
	console.warn('Embed failed. Opening RES settings console in new tab');
	if (iframe) openNewTab(iframe.src, true);
	close();
}

export function open(moduleID?: string, optionKey?: string) {
	if (iframe || isOptionsPage()) {
		// A module id and an option key are not secret, but the frame is still the
		// options page and nothing else, and on the options page itself the target
		// is this window. Naming both removes the only remaining `'*'` here.
		const target = iframe && iframe.contentWindow || window;
		const origin = iframe ? getOptionsURL().origin : location.origin;
		target.postMessage({ load: { moduleID, optionKey } }, origin);
	} else {
		iframe = document.createElement('iframe');
		iframe.id = 'console-container';
		iframe.src = getOptionsURL(makeUrlHash(moduleID, optionKey)).href;

		window.addEventListener('message', listener);
		window.addEventListener('message', progressListener);
		iframe.addEventListener('load', () => {
			// `context` carries `userHash` - the modhash `ajax.js` sends as
			// `X-Modhash`. `'*'` delivered it to whatever origin the frame happened
			// to be showing, and this listener is attached once but fires on every
			// navigation of the frame, so page script that repoints
			// `#console-container` would have been handed the token. Address it the
			// way `sendDiagnostics` below already does: we know exactly who this is
			// for, so say so.
			if (iframe) iframe.contentWindow.postMessage({ context }, getOptionsURL().origin);

			// If the console doesn't progress fast enough (like due to an embedding
			// issue), use fallback. The listener that watches for progress is
			// registered once beside `listener` above and removed in `close()`: it
			// used to be created inside this handler, which fires on every
			// navigation *inside* the frame, so each one left another anonymous
			// listener on the page's window holding its closure. Small per open,
			// but on current Reddit the document lives for the whole session.
			embedProgressed = false;
			setTimeout(() => { if (!embedProgressed) handleEmbedFailure(); }, 3000);
		});

		document.body.append(iframe);
		document.body.classList.add('res-console-open');
	}
}

export function close() {
	if (isOptionsPage()) {
		window.parent.postMessage({ closing: true }, '*');
		window.close();
	} else {
		window.removeEventListener('message', listener);
		window.removeEventListener('message', progressListener);
		if (!iframe) return;
		iframe.remove();
		iframe = null;
		document.body.classList.remove('res-console-open');
		if (isSettingsUrl(location.href)) history.pushState(null, '', location.pathname + location.search);
	}
}
