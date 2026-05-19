/* @flow */
// RES-Slim: optional redirect from www.reddit.com (the modern "redesign" surface)
// to old.reddit.com. Default OFF — many users intentionally browse www.reddit.com
// for some flows. Also injects a small old/www/sh host-toggle pill into the
// userbar so users can hop between hosts without typing.

import { Module } from '../core/module';

export const module: Module<*> = new Module('oldRedditRedirect');

module.moduleName = 'Old Reddit redirect + host toggle';
module.category = 'browsingCategory';
module.description = 'Optionally redirect www.reddit.com to old.reddit.com. Adds an old/www/sh host toggle to the header.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['redirect', 'old', 'host', 'toggle', 'www', 'sh'];

module.options = {
	autoRedirect: {
		type: 'boolean',
		value: false,
		title: 'Auto-redirect www.reddit.com to old.reddit.com',
		description: 'Default off. When on, navigating to www.reddit.com will immediately bounce to old.reddit.com.',
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
	if (location.host !== 'www.reddit.com') return;
	const next = new URL(location.href);
	next.host = 'old.reddit.com';
	// Use replace() so the user does not have to step over the original URL with Back.
	location.replace(next.toString());
}

function rebuildToggle() {
	if (!module.options.showHostToggle.value) return;
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
		const next = new URL(location.href);
		next.host = targetHost;
		a.href = next.toString();
		a.textContent = key;
		a.className = 'rsm-host-toggle-link';
		a.dataset.host = key;
		if (location.host === targetHost) a.classList.add('is-active');
		a.title = `Switch to ${targetHost}`;
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
