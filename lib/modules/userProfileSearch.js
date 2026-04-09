/* @flow */
// RES-Slim: add a small "search this user on the web" icon next to every username.
// Inspired by minnieo's "Reddit Private Profile Search (old reddit)" userscript.

import { Module } from '../core/module';
import { watchForElements } from '../utils';

export const module: Module<*> = new Module('userProfileSearch');

module.moduleName = 'User profile search icon';
module.category = 'productivityCategory';
module.description = 'Adds a tiny magnifying-glass link next to each username that runs a web search for that user, useful when a profile is hidden.';
module.descriptionRaw = true;
module.options = {
	engine: {
		type: 'enum',
		value: 'duckduckgo',
		values: [
			{ name: 'DuckDuckGo', value: 'duckduckgo' },
			{ name: 'Google', value: 'google' },
			{ name: 'Kagi', value: 'kagi' },
		],
		title: 'Search engine',
		description: 'Which search engine to query.',
	},
};

function searchUrl(username: string): string {
	const q = encodeURIComponent(`site:reddit.com "u/${username}"`);
	switch (module.options.engine.value) {
		case 'google': return `https://www.google.com/search?q=${q}`;
		case 'kagi': return `https://kagi.com/search?q=${q}`;
		default: return `https://duckduckgo.com/?q=${q}`;
	}
}

function decorate(anchor: HTMLAnchorElement) {
	if (anchor.dataset.resSlimUps) return;
	anchor.dataset.resSlimUps = '1';
	const match = /\/user\/([^/]+)/.exec(anchor.href);
	if (!match) return;
	const username = match[1];
	const icon = document.createElement('a');
	icon.href = searchUrl(username);
	icon.target = '_blank';
	icon.rel = 'noopener';
	icon.title = `Search the web for u/${username}`;
	icon.textContent = '\u{1F50D}';
	icon.style.marginLeft = '3px';
	icon.style.textDecoration = 'none';
	icon.style.fontSize = '10px';
	anchor.insertAdjacentElement('afterend', icon);
}

module.contentStart = () => {
	document.querySelectorAll('a.author').forEach(a => {
		if (a instanceof HTMLAnchorElement) decorate(a);
	});
	watchForElements(['page'], 'a.author', (ele: HTMLElement) => {
		if (ele instanceof HTMLAnchorElement) decorate(ele);
	});
};
