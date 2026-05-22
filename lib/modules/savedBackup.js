/* @flow */
// RES-Slim: paginate the logged-in user's `/user/<me>/saved.json` and dump
// the full list to a single JSON file. Local-only — the only network call
// is to reddit itself (same origin, uses session cookie). No external
// service required.

import { Module } from '../core/module';
import { createRateLimiter } from '../utils/rateLimiter';
import { flashStatus } from '../utils/buttonStatus';
import {
	buildExport,
	buildSavedUrl,
	mergeAndDedupe,
	parseSavedPage,
} from '../utils/savedBackup';
import type { SavedItem } from '../utils/savedBackup';

export const module: Module<*> = new Module('savedBackup');

module.moduleName = 'Saved-content backup';
module.category = 'productivityCategory';
module.description = 'Adds a "Backup saved" link in the userbar. Walks the logged-in user\'s entire `saved` listing via the reddit JSON API and downloads a single JSON file. No external services involved.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['saved', 'backup', 'export', 'json', 'download'];

module.options = {
	pageLimit: {
		type: 'text',
		value: '100',
		title: 'Items per page',
		description: 'Reddit caps at 100 per page; lower values produce more pages but smaller bursts.',
	},
	maxPages: {
		type: 'text',
		value: '100',
		title: 'Max pages',
		description: 'Hard cap to avoid runaway pagination. At 100 items/page, 100 pages = 10,000 saved items.',
	},
};

const limiter = createRateLimiter({ tokens: 2, refillMs: 1500, maxConcurrent: 2 });
const TRIGGER_ID = 'rsm-savedBackup-trigger';

function currentUsername(): string {
	const userLink = document.querySelector('#header-bottom-right .user a');
	if (userLink instanceof HTMLAnchorElement) {
		const m = /\/user\/([^/]+)/.exec(userLink.href);
		if (m) return decodeURIComponent(m[1]);
	}
	return '';
}

async function fetchPage(username: string, after: ?string, limit: number): Promise<{| items: SavedItem[], after: ?string |}> {
	const url = buildSavedUrl(username, after, limit);
	return limiter.schedule(async () => {
		const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (!res.ok) throw new Error(`status ${res.status}`);
		const json = await res.json();
		return parseSavedPage(json);
	});
}

function triggerDownload(text: string, filename: string): void {
	const blob = new Blob([text], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

async function runBackup(button: HTMLAnchorElement, restoreText: string): Promise<void> {
	const username = currentUsername();
	if (!username) {
		flashStatus(button, 'not logged in', { restore: restoreText, durationMs: 5000 });
		return;
	}
	const pageLimit = Math.max(1, Math.min(100, parseInt(String(module.options.pageLimit.value || '100'), 10) || 100));
	const maxPages = Math.max(1, parseInt(String(module.options.maxPages.value || '100'), 10) || 100);
	let after: ?string = null;
	let collected: SavedItem[] = [];
	for (let i = 0; i < maxPages; i++) {
		flashStatus(button, `page ${i + 1}…`);
		const { items, after: nextAfter } = await fetchPage(username, after, pageLimit);
		if (!items.length) break;
		collected = mergeAndDedupe(collected, items);
		if (!nextAfter) break;
		after = nextAfter;
	}
	if (!collected.length) {
		flashStatus(button, 'no saved items', { restore: restoreText, durationMs: 5000 });
		return;
	}
	const payload = buildExport(username, collected);
	triggerDownload(JSON.stringify(payload, null, 2), `saved-${username}-${new Date().toISOString().slice(0, 10)}.json`);
	flashStatus(button, `✓ ${collected.length} items`, { restore: restoreText, durationMs: 6000 });
}

function injectTrigger(): void {
	if (document.getElementById(TRIGGER_ID)) return;
	const userbar = document.querySelector('#header-bottom-right');
	if (!(userbar instanceof HTMLElement)) return;
	const sep = document.createElement('span');
	sep.textContent = ' | ';
	sep.id = `${TRIGGER_ID}-sep`;
	const a = document.createElement('a');
	a.href = '#';
	a.id = TRIGGER_ID;
	a.textContent = 'backup saved';
	a.title = 'Walk /user/<me>/saved.json and download a JSON dump';
	const restoreText = a.textContent;
	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		try {
			await runBackup(a, restoreText);
		} catch (err) {
			flashStatus(a, `failed: ${String((err && (err: any).message) || 'fetch')}`, { restore: restoreText, durationMs: 6000 });
		}
	});
	userbar.append(sep, a);
}

module.contentStart = () => {
	injectTrigger();
};
