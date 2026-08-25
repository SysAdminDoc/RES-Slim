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

export const module: Module<{ [string]: any }> = new Module('perSubSort');

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

const store = Storage.wrapFeatureBlob('perSubSort', 'RESmodules.perSubSort.prefs', (): SortPreference | null => null);
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
		const pref: SortPreference = (route.t && (route.sort === 'top' || route.sort === 'controversial')) ?
			{ sort: route.sort, t: route.t } :
			{ sort: route.sort };
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
	// The label rewrites itself to report the outcome of a save, so announce it.
	btn.setAttribute('aria-live', 'polite');
	li.append(btn);

	// Single writer for the label so the star element is never lost to a
	// textContent assignment, and so every state sets its matching style hook.
	const setLabel = (text: string, state: '' | 'saved' | 'error' = '') => {
		const star = document.createElement('span');
		star.className = STAR_CLASS;
		star.textContent = '★';
		btn.textContent = '';
		btn.append(star, ` ${text}`);
		if (state) li.dataset.rsmSaved = state;
		else delete li.dataset.rsmSaved;
	};

	const idleLabel = () => {
		setLabel('remember sort');
		btn.title = `Save the current sort as the default for r/${String(route.sub)}`;
	};

	idleLabel();

	let resetTimer;
	btn.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		const visible = currentVisibleSort();
		if (!visible || !route.sub) {
			setLabel('pick a sort first', 'error');
			btn.title = 'Choose hot, new, top or rising above, then save it as the default.';
		} else {
			try {
				await store.set(route.sub, visible);
				const window = visible.t ? ` / ${visible.t}` : '';
				setLabel(`saved — ${visible.sort}${window}`, 'saved');
				btn.title = `r/${route.sub} will now open on ${visible.sort}${window}.`;
			} catch (err) {
				console.error('RES-Slim perSubSort: could not save sort preference', err);
				setLabel('couldn’t save', 'error');
				btn.title = 'Saving failed — check that the extension has storage access, then try again.';
			}
		}
		clearTimeout(resetTimer);
		resetTimer = setTimeout(idleLabel, 2500);
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
