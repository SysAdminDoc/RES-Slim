/* @flow */
// RES-Slim: remember the user's preferred sort for each subreddit. When the
// bare /r/<sub>/ URL is hit, redirect to the saved sort (and time-window for
// top/controversial). Inject a `★ remember sort` button next to the sort
// dropdown so the preference is saved with one click.

import { Module } from '../core/module';
import { Storage } from '../environment';
import {
	buildSortedPath,
	normalizePreference,
	parseSubListingPath,
	shouldRedirect,
} from '../utils/perSubSort';
import type { SortPreference, SortRoute } from '../utils/perSubSort';

export const module: Module<*> = new Module('perSubSort');

module.moduleName = 'Per-sub default sort';
module.category = 'browsingCategory';
module.description = 'Remember the preferred sort per subreddit. On a bare /r/<sub>/ URL, redirect to your saved sort (and time-window for top/controversial). The "★ remember sort" button next to the sort dropdown saves the current view.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['sort', 'subreddit', 'default', 'memory', 'remember'];

module.options = {
	redirectOnEntry: {
		type: 'boolean',
		value: true,
		title: 'Redirect on entry',
		description: 'When you visit /r/<sub>/ without a sort, redirect to your saved sort. Disable to only show the save button.',
	},
	showSaveButton: {
		type: 'boolean',
		value: true,
		title: 'Show save button',
		description: 'Inject a "★ remember sort" button next to the sort dropdown.',
	},
};

const store = Storage.wrapBlob('RESmodules.perSubSort.prefs', (): SortPreference | null => null);
const BTN_CLASS = 'rsm-perSubSort-save';
const STAR_CLASS = 'rsm-perSubSort-star';

function currentRoute(): SortRoute {
	return parseSubListingPath(location.pathname, location.search);
}

function currentVisibleSort(): SortPreference | null {
	// On a sort-prefixed URL the body class encodes the sort. The select also
	// shows the active option. Fall back to the URL parse.
	const route = currentRoute();
	if (route.sort) {
		const pref: SortPreference = (route.t && (route.sort === 'top' || route.sort === 'controversial'))
			? { sort: route.sort, t: route.t }
			: { sort: route.sort };
		return pref;
	}
	// Old.reddit body class encodes hot/new/rising for the bare /r/<sub>/ URL.
	if (document.body) {
		for (const sort of ['hot', 'new', 'rising', 'top', 'controversial', 'best']) {
			if (document.body.classList.contains(`${sort}-page`)) {
				return { sort };
			}
		}
	}
	return null;
}

async function applyRedirect(route: SortRoute): Promise<void> {
	if (!route.sub) return;
	if (module.options.redirectOnEntry.value !== true) return;
	const stored = normalizePreference(await store.getNullable(route.sub));
	if (!stored) return;
	if (!shouldRedirect(route, stored)) return;
	const target = buildSortedPath(route.sub, stored);
	// Avoid loops: only redirect when the destination differs from where we are.
	if (target === `${location.pathname}${location.search}`) return;
	location.replace(target);
}

function findSortMenuHost(): ?HTMLElement {
	// Listing page sort dropdown lives in `.tabmenu` (top of feed).
	const tabmenu = document.querySelector('body.listing-page .tabmenu, body.search-page .tabmenu');
	if (tabmenu instanceof HTMLElement) return tabmenu;
	return null;
}

function injectSaveButton(route: SortRoute): void {
	if (module.options.showSaveButton.value !== true) return;
	if (!route.sub) return;
	const host = findSortMenuHost();
	if (!host) return;
	if (host.querySelector(`:scope > .${BTN_CLASS}`)) return;

	const li = document.createElement('li');
	li.className = BTN_CLASS;
	const btn = document.createElement('a');
	btn.href = '#';
	btn.setAttribute('role', 'button');
	const star = document.createElement('span');
	star.className = STAR_CLASS;
	star.textContent = '★';
	btn.append(star, ' remember sort');
	btn.title = `Save the current sort as the default for r/${route.sub}`;
	li.append(btn);

	btn.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		const visible = currentVisibleSort();
		if (!visible || !route.sub) {
			btn.textContent = '★ no sort to save';
			return;
		}
		try {
			await store.set(route.sub, visible);
			btn.textContent = `★ saved (${visible.sort}${visible.t ? `/${visible.t}` : ''})`;
		} catch (err) {
			btn.textContent = '★ save failed';
		}
		setTimeout(() => {
			const label = document.createElement('span');
			label.className = STAR_CLASS;
			label.textContent = '★';
			btn.textContent = '';
			btn.append(label, ' remember sort');
		}, 2500);
	});
	host.append(li);
}

module.beforeLoad = async () => {
	const route = currentRoute();
	await applyRedirect(route);
};

module.contentStart = () => {
	const route = currentRoute();
	if (!route.sub) return;
	injectSaveButton(route);
};
