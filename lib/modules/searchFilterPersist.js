/* @flow */
// RES-Slim: persist the user's preferred sort + time-window on /search across
// queries. Old Reddit resets these to relevance/all on every new search,
// which forces a second click to get the same results pattern. This module
// remembers the last explicit choice and replays it.

import { Module } from '../core/module';

export const module: Module<*> = new Module('searchFilterPersist');

module.moduleName = 'Search filter persistence';
module.category = 'browsingCategory';
module.description = 'Remember your preferred search sort + time window and reapply them on every /search.';
module.descriptionRaw = true;
// `matchesPageLocation` ORs an include list, and `search` is a page type the
// redesign declares too, so the `'r2'` that used to sit here restricted nothing
// — it matched nothing `'search'` had not already admitted, while reading like a
// restriction. `exclude` is the only half of that function that ANDs.
module.include = ['search'];
module.exclude = ['d2x'];
module.keywords = ['search', 'sort', 'time', 'filter', 'persistence', 'remember'];

module.options = {};

const STORAGE_KEY = 'rsm-search-filter';

const VALID_SORT = new Set(['relevance', 'new', 'top', 'comments']);
const VALID_T = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

type SearchPrefs = {| sort?: string, t?: string |};

function load(): SearchPrefs {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return {};
		const prefs: SearchPrefs = {};
		if (typeof parsed.sort === 'string' && VALID_SORT.has(parsed.sort)) prefs.sort = parsed.sort;
		if (typeof parsed.t === 'string' && VALID_T.has(parsed.t)) prefs.t = parsed.t;
		return prefs;
	} catch (e) {
		return {};
	}
}

function save(prefs: SearchPrefs) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch (e) {
		// quota / disabled — ignore
	}
}

function isSearchPath(): boolean {
	return /^\/(r\/[^/]+\/)?search\b/.test(location.pathname) || location.pathname.endsWith('/search');
}

function captureCurrentFromUrl() {
	const params = new URLSearchParams(location.search);
	const prefs = load();
	const sort = params.get('sort');
	const t = params.get('t');
	let changed = false;
	if (sort && VALID_SORT.has(sort) && prefs.sort !== sort) { prefs.sort = sort; changed = true; }
	if (t && VALID_T.has(t) && prefs.t !== t) { prefs.t = t; changed = true; }
	if (changed) save(prefs);
}

function maybeReplayOnLanding() {
	if (!isSearchPath()) return;
	const url = new URL(location.href);
	const params = url.searchParams;
	if (!params.get('q')) return;
	const prefs = load();
	let changed = false;
	if (!params.has('sort') && prefs.sort) { params.set('sort', prefs.sort); changed = true; }
	if (!params.has('t') && prefs.t) { params.set('t', prefs.t); changed = true; }
	if (changed) location.replace(url.toString());
}

function captureFormSubmissions() {
	document.addEventListener('submit', (e: Event) => {
		const form = e.target;
		if (!(form instanceof HTMLFormElement)) return;
		if (!form.action.includes('/search')) return;
		const sortInput = form.querySelector('input[name="sort"], select[name="sort"]');
		const tInput = form.querySelector('input[name="t"], select[name="t"]');
		const prefs = load();
		if (sortInput instanceof HTMLInputElement || sortInput instanceof HTMLSelectElement) {
			const v = (sortInput.value || '').trim();
			if (VALID_SORT.has(v)) prefs.sort = v;
		}
		if (tInput instanceof HTMLInputElement || tInput instanceof HTMLSelectElement) {
			const v = (tInput.value || '').trim();
			if (VALID_T.has(v)) prefs.t = v;
		}
		save(prefs);
	}, true);
}

module.beforeLoad = () => {
	maybeReplayOnLanding();
};

module.contentStart = () => {
	captureCurrentFromUrl();
	captureFormSubmissions();
};
