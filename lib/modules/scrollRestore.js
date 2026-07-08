/* @flow */
// RES-Slim: remember the scroll position per comment thread so coming back to a
// thread lands you where you left off. Backed by localStorage; capped at
// 200 entries with LRU pruning. Persists across tabs and reloads, scoped
// per pathname (no query/hash sensitivity — those usually indicate a
// targeted permalink jump).
//
// Scoped to comment threads only: listing pages (subreddit fronts, the home
// feed, user/search pages) always load at the top. Restoring a stale listing
// position — e.g. the bottom of a previous session — is disorienting, and
// listings change constantly so a saved offset is rarely meaningful.

import { Module } from '../core/module';
import { isPageType } from '../utils';

export const module: Module<*> = new Module('scrollRestore');

module.moduleName = 'Restore scroll position';
module.category = 'browsingCategory';
module.description = 'Remember where you were in a comment thread and scroll back to that position when you revisit. Listing pages (subreddits, the home feed) always load at the top.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['scroll', 'position', 'remember', 'thread', 'navigation'];

module.options = {
	maxEntries: {
		type: 'text',
		value: '200',
		title: 'Maximum saved positions',
		description: 'LRU cap on the number of remembered pathnames.',
	},
};

const STORAGE_KEY = 'rsm-scroll-restore';
const SAVE_DEBOUNCE_MS = 250;
const MIN_SCROLL_TO_SAVE = 200;

type StorageBlob = {
	[pathname: string]: {| y: number, t: number |},
};

function load(): StorageBlob {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return {};
		return (parsed: any);
	} catch (e) {
		return {};
	}
}

function persist(blob: StorageBlob) {
	const max = Math.max(1, Number(module.options.maxEntries.value) || 200);
	const entries = Object.entries(blob)
		.sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
		.slice(0, max);
	const pruned: StorageBlob = {};
	for (const [k, v] of entries) pruned[k] = (v: any);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
	} catch (e) {
		// Quota / disabled — fall through silently.
	}
}

let saveTimer: TimeoutID | null = null;
let restoreOnce = false;

function scheduleSave() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		const y = window.scrollY;
		const blob = load();
		if (y < MIN_SCROLL_TO_SAVE) {
			delete blob[location.pathname];
		} else {
			blob[location.pathname] = { y, t: Date.now() };
		}
		persist(blob);
	}, SAVE_DEBOUNCE_MS);
}

function restore() {
	if (restoreOnce) return;
	restoreOnce = true;
	if (location.hash) return; // hash jumps should win over restore
	const blob = load();
	const entry = blob[location.pathname];
	if (!entry || typeof entry.y !== 'number') return;
	const targetY = entry.y;
	// Wait for the page to stabilise — embedded images/listings can shift
	// layout for a few frames after DOMContentLoaded.
	requestAnimationFrame(() => {
		window.scrollTo(0, targetY);
		// One delayed pass in case media expanded.
		setTimeout(() => { window.scrollTo(0, targetY); }, 300);
	});
}

module.contentStart = () => {
	// Only remember/restore scroll position on comment threads. On any listing
	// page (subreddit front, home feed, user/search pages) do nothing, so the
	// page always loads at the top.
	if (!isPageType('comments')) return;
	restore();
	window.addEventListener('scroll', scheduleSave, { passive: true });
	window.addEventListener('beforeunload', () => {
		if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
		const y = window.scrollY;
		const blob = load();
		if (y < MIN_SCROLL_TO_SAVE) {
			delete blob[location.pathname];
		} else {
			blob[location.pathname] = { y, t: Date.now() };
		}
		persist(blob);
	});
};
