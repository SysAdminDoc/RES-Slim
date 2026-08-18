/* @flow */
// RES-Slim: optional redirect from www.reddit.com (the modern "redesign" surface)
// to old.reddit.com. The redirect itself is off by default — many users
// intentionally browse www.reddit.com for some flows. Also injects a small
// old/www/sh host-toggle pill into the userbar so users can hop hosts without
// typing.
//
// The include list must carry d2x as well as r2. `appType()` returns 'r2' only
// when <html> has old reddit's xmlns attribute; on www.reddit.com it returns
// 'd2x'. With an r2-only include this module never ran on the host it exists to
// redirect away from, so `autoRedirect` was inert — the guard inside
// maybeRedirect() was unreachable code.

import { Module } from '../core/module';
import { isAppType } from '../utils';
import { hostToggleUrl, oldRedditUrl } from '../utils/oldRedditRedirect';

export const module: Module<*> = new Module('oldRedditRedirect');

module.moduleName = 'Old Reddit redirect + host toggle';
module.category = 'browsingCategory';
module.description = 'Optionally redirect www.reddit.com to old.reddit.com before the modern page loads. Adds an old/www/sh host toggle to the header.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.keywords = ['redirect', 'old', 'host', 'toggle', 'www', 'sh'];

module.options = {
	autoRedirect: {
		type: 'boolean',
		value: false,
		title: 'Auto-redirect www.reddit.com to old.reddit.com',
		description: 'Default off. When on, a browser request rule swaps the host before modern Reddit downloads. Account, login, and advertising routes remain untouched.',
	},
	showHostToggle: {
		type: 'boolean',
		value: true,
		title: 'Show old/www/sh host toggle',
		description: 'Inject a small host-toggle pill into the page header so you can flip hosts manually.',
	},
};

const HOSTS = Object.freeze([
	{ key: 'old', host: 'old.reddit.com' },
	{ key: 'www', host: 'www.reddit.com' },
	{ key: 'sh', host: 'sh.reddit.com' },
]);

const TOGGLE_ID = 'RSMHostToggle';

function maybeRedirect() {
	if (!module.options.autoRedirect.value) return;
	const next = oldRedditUrl(location.href);
	if (!next) return;
	// Use replace() so the user does not have to step over the original URL with Back.
	location.replace(next);
}

function rebuildToggle() {
	if (!module.options.showHostToggle.value) return;
	// The toggle mounts into old.reddit’s userbar, which does not exist on the
	// redesign; only the redirect half of this module applies there.
	if (!isAppType('r2')) return;
	if (document.getElementById(TOGGLE_ID)) return;
	const host = document.getElementById('header-bottom-right') || document.querySelector('#header .tabmenu');
	if (!(host instanceof HTMLElement)) return;

	const wrapper = document.createElement('span');
	wrapper.id = TOGGLE_ID;
	wrapper.className = 'rsm-host-toggle';
	wrapper.setAttribute('role', 'group');
	wrapper.setAttribute('aria-label', 'Reddit host');

	for (const { key, host: targetHost } of HOSTS) {
		const a = document.createElement('a');
		const next = hostToggleUrl(location.href, targetHost, module.options.autoRedirect.value === true);
		if (!next) continue;
		a.href = next;
		a.textContent = key;
		a.className = 'rsm-host-toggle-link';
		a.dataset.host = key;
		if (location.host === targetHost) a.classList.add('is-active');
		a.title = targetHost === 'www.reddit.com' && module.options.autoRedirect.value === true ?
			`Switch to ${targetHost} for this page` :
			`Switch to ${targetHost}`;
		wrapper.append(a);
	}

	host.append(wrapper);
}

module.beforeLoad = () => {
	maybeRedirect();
};

module.contentStart = () => {
	maybeRedirect();
	rebuildToggle();
};
