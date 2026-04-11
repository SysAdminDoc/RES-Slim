/* @flow */

import { RES_SETTINGS_HASH } from '../constants/urlHashes';
import { context, isOptionsPage, getOptionsURL, i18n, openNewTab } from '../environment';
import { string } from '../utils';
import { Module } from '../core/module';
import * as Modules from '../core/modules';
import * as Menu from '../modules/menu';

export const module: Module<*> = new Module('settingsNavigation');

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
	return `<a class="${cssClass || ''}" href="${hash}" title="${title}">${displayText}</a>`;
}

export function parseHash(hash: string) {
	const normalizedHash = hash.startsWith('#!settings') ?
		hash.replace(/^#!settings/, RES_SETTINGS_HASH) :
		hash;
	if (!normalizedHash.startsWith(RES_SETTINGS_HASH)) {
		return {
			moduleID: undefined,
			optionKey: undefined,
		};
	}

	// The prefix must be followed by `/` or end-of-string. Otherwise a URL
	// like `#res:settings-redirect-standalone-options-page/accountSwitcher`
	// (a separate route with the settings hash as a literal prefix) would
	// get parsed as if its first path segment were `-redirect-standalone-...`.
	const rest = normalizedHash.slice(RES_SETTINGS_HASH.length);
	if (rest && !rest.startsWith('/')) {
		return {
			moduleID: undefined,
			optionKey: undefined,
		};
	}

	const path = rest.replace(/^\/+/, '');
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

	return hash.startsWith(RES_SETTINGS_HASH) ||
		hash.startsWith('#!settings'); /* legacy */
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

function listener({ origin, data }: MessageEvent) {
	if (origin !== getOptionsURL().origin) return;
	const { failedToLoad, hash, closing } = (data: any);
	if (failedToLoad) handleEmbedFailure();
	if (hash) setHash(hash);
	if (closing) close();
}

function handleEmbedFailure() {
	console.warn('Embed failed. Opening RES settings console in new tab');
	if (iframe) openNewTab(iframe.src, true);
	close();
}

export function open(moduleID?: string, optionKey?: string) {
	if (iframe || isOptionsPage()) {
		(iframe && iframe.contentWindow || window).postMessage({ load: { moduleID, optionKey } }, '*');
	} else {
		iframe = document.createElement('iframe');
		iframe.id = 'console-container';
		iframe.src = getOptionsURL(makeUrlHash(moduleID, optionKey)).href;

		window.addEventListener('message', listener);
		iframe.addEventListener('load', () => {
			if (iframe) iframe.contentWindow.postMessage({ context }, '*');

			// If the console doesn't progress fast enough (like due to an embedding issue), use fallback
			let success;
			window.addEventListener('message', ({ origin, data }: MessageEvent) => {
				if (origin === getOptionsURL().origin && (data: any).loadSuccess) success = true;
			});
			setTimeout(() => { if (!success) handleEmbedFailure(); }, 3000);
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
		if (!iframe) return;
		iframe.remove();
		iframe = null;
		document.body.classList.remove('res-console-open');
		if (isSettingsUrl(location.href)) history.pushState(null, '', location.pathname + location.search);
	}
}
