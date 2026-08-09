/* @flow */
// RES-Slim: keep a local, searchable index of the logged-in user's saved
// posts/comments. Reddit is read only during an explicit sync; tags and the
// indexed content stay in IndexedDB and are never sent anywhere.

import { Module } from '../core/module';
import { createRateLimiter } from '../utils/rateLimiter';
import {
	buildExport,
	buildSavedUrl,
	filterSavedItems,
	listSavedTags,
	loadSavedRecords,
	mergeSavedRecordsIntoStore,
	normalizeSavedTag,
	normalizeSavedTags,
	parseSavedPage,
	updateSavedRecordTags,
} from '../utils/savedBackup';
import type { SavedItem, SavedRecord } from '../utils/savedBackup';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<*> = new Module('savedBackup');

module.moduleName = 'Saved-content manager';
module.category = 'productivityCategory';
module.description = 'Adds a local saved-content manager in the userbar. Explicitly syncs the logged-in user\'s saved listing, indexes posts and comments on this device, and supports local search and tags. Nothing is transmitted beyond the Reddit sync request.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['saved', 'backup', 'export', 'json', 'search', 'tags', 'local'];

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
const PANEL_ID = 'rsm-savedBackup-panel';
const PANEL_TITLE_ID = 'rsm-savedBackup-title';

let panelOpen = false;
let records: SavedRecord[] = [];
let managerState;

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
	return limiter.schedule(() => fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
		.then(async res => {
			if (!res.ok) { notifyRedditApiBlocked(res.status); throw new Error(`status ${res.status}`); }
			return parseSavedPage(await res.json());
		}));
}

async function fetchAllSavedItems(status: ?HTMLElement): Promise<{| username: string, items: SavedItem[] |}> {
	const username = currentUsername();
	if (!username) throw new Error('Log in to Reddit before syncing saved content.');
	const pageLimit = Math.max(1, Math.min(100, parseInt(String(module.options.pageLimit.value || '100'), 10) || 100));
	const maxPages = Math.max(1, parseInt(String(module.options.maxPages.value || '100'), 10) || 100);
	let after: ?string = null;
	let collected: SavedItem[] = [];
	for (let i = 0; i < maxPages; i++) {
		if (status) status.textContent = `Syncing saved content — page ${i + 1}…`;
		const { items, after: nextAfter } = await fetchPage(username, after, pageLimit);
		if (!items.length) break;
		collected = [...new Map([...collected, ...items].map(item => [item.fullname, item])).values()];
		if (!nextAfter) break;
		after = nextAfter;
	}
	return { username, items: collected };
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

function makeButton(text: string, className: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = className;
	button.textContent = text;
	return button;
}

function closeManager(opts: { restoreFocus?: boolean } = {}) {
	const panel = document.getElementById(PANEL_ID);
	if (panel) panel.remove();
	panelOpen = false;
	document.removeEventListener('keydown', onManagerKeydown, true);
	document.removeEventListener('pointerdown', onManagerPointerDown, true);
	managerState = null;
	if (opts.restoreFocus) {
		const trigger = document.getElementById(TRIGGER_ID);
		if (trigger instanceof HTMLElement) trigger.focus();
	}
}

function onManagerKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape' && panelOpen) {
		e.preventDefault();
		closeManager({ restoreFocus: true });
	}
}

function onManagerPointerDown(e: Event) {
	if (!panelOpen || !(e.target instanceof Node)) return;
	const panel = document.getElementById(PANEL_ID);
	const trigger = document.getElementById(TRIGGER_ID);
	if (panel && panel.contains(e.target)) return;
	if (trigger && trigger.contains(e.target)) return;
	closeManager();
}

function renderTagFilter(select: HTMLSelectElement) {
	const selected = select.value;
	select.replaceChildren();
	const all = document.createElement('option');
	all.value = '';
	all.textContent = 'All tags';
	select.append(all);
	const untagged = document.createElement('option');
	untagged.value = '__untagged__';
	untagged.textContent = 'Untagged';
	select.append(untagged);
	for (const tag of listSavedTags(records)) {
		const option = document.createElement('option');
		option.value = tag;
		option.textContent = tag;
		select.append(option);
	}
	if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function renderRecordTags(record: SavedRecord): HTMLElement {
	const wrap = document.createElement('div');
	wrap.className = 'rsm-savedBackup-tags';
	for (const tag of record.tags) {
		const chip = document.createElement('span');
		chip.className = 'rsm-savedBackup-tag';
		chip.textContent = tag;
		const remove = makeButton('×', 'rsm-savedBackup-tag-remove');
		remove.setAttribute('aria-label', `Remove tag ${tag}`);
		remove.addEventListener('click', () => { saveTags(record, record.tags.filter(item => item !== tag)); });
		chip.append(remove);
		wrap.append(chip);
	}
	return wrap;
}

function itemSummary(record: SavedRecord): string {
	const source = record.kind === 't3' ? (record.title || record.body) : record.body;
	const text = source.replace(/\s+/g, ' ').trim();
	return text.length > 220 ? `${text.slice(0, 219)}…` : text;
}

function renderRecord(record: SavedRecord): HTMLElement {
	const item = document.createElement('li');
	item.className = 'rsm-savedBackup-item';
	const title = document.createElement('a');
	title.className = 'rsm-savedBackup-item-title';
	title.textContent = record.title || itemSummary(record) || '(saved comment)';
	if (record.permalink) {
		title.href = new URL(record.permalink, location.origin).href;
		title.target = '_blank';
		title.rel = 'noreferrer';
	}
	const meta = document.createElement('div');
	meta.className = 'rsm-savedBackup-item-meta';
	meta.textContent = `${record.kind === 't3' ? 'Post' : 'Comment'} · ${record.subreddit ? `r/${record.subreddit}` : 'unknown subreddit'} · u/${record.author || '[deleted]'}`;
	const summary = document.createElement('p');
	summary.className = 'rsm-savedBackup-item-summary';
	summary.textContent = itemSummary(record);
	const tagArea = renderRecordTags(record);
	const form = document.createElement('form');
	form.className = 'rsm-savedBackup-tag-form';
	const input = document.createElement('input');
	input.type = 'text';
	input.maxLength = 48;
	input.placeholder = 'Add a tag';
	input.setAttribute('aria-label', `Add a tag to ${title.textContent}`);
	const add = makeButton('Add tag', 'rsm-savedBackup-add-tag');
	form.append(input, add);
	form.addEventListener('submit', e => {
		e.preventDefault();
		const next = normalizeSavedTag(input.value);
		if (!next) return;
		saveTags(record, normalizeSavedTags([...record.tags, next]));
	});
	item.append(title, meta, summary, tagArea, form);
	return item;
}

function renderRecords() {
	if (!managerState || !panelOpen) return;
	const { list, meta, tagFilter } = managerState;
	renderTagFilter(tagFilter);
	const visible = filterSavedItems(records, managerState.search.value, tagFilter.value);
	list.replaceChildren();
	meta.textContent = `${visible.length.toLocaleString()} shown · ${records.length.toLocaleString()} indexed`;
	if (!visible.length) {
		const empty = document.createElement('li');
		empty.className = 'rsm-savedBackup-empty';
		empty.textContent = records.length ? 'No saved items match this search.' : 'Nothing indexed yet. Sync your saved listing to begin.';
		list.append(empty);
		return;
	}
	for (const record of visible) list.append(renderRecord(record));
}

async function saveTags(record: SavedRecord, tags: string[]) {
	try {
		const updated = await updateSavedRecordTags(record.fullname, tags);
		if (!updated) return;
		records = records.map(item => item.fullname === updated.fullname ? updated : item);
		renderRecords();
	} catch (error) {
		if (managerState && managerState.status) managerState.status.textContent = `Could not save tags: ${String(error && (error: any).message || error)}`;
	}
}

async function syncSavedContent() {
	if (!managerState) return;
	const { sync, status } = managerState;
	sync.disabled = true;
	try {
		const result = await fetchAllSavedItems(status);
		records = await mergeSavedRecordsIntoStore(result.items);
		status.textContent = `Indexed ${result.items.length.toLocaleString()} Reddit items locally.`;
		renderRecords();
	} catch (error) {
		status.textContent = String(error && (error: any).message || error);
	} finally {
		sync.disabled = false;
	}
}

function exportSavedContent() {
	const username = currentUsername() || 'local';
	const payload = buildExport(username, records);
	triggerDownload(JSON.stringify(payload, null, 2), `saved-${username}-${new Date().toISOString().slice(0, 10)}.json`);
}

function createManagerPanel(): HTMLElement {
	const panel = document.createElement('section');
	panel.id = PANEL_ID;
	panel.className = 'rsm-savedBackup-panel';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'false');
	panel.setAttribute('aria-labelledby', PANEL_TITLE_ID);
	const header = document.createElement('header');
	header.className = 'rsm-savedBackup-header';
	const title = document.createElement('h2');
	title.id = PANEL_TITLE_ID;
	title.className = 'rsm-savedBackup-title';
	title.textContent = 'Saved content';
	const close = makeButton('Close', 'rsm-savedBackup-close');
	close.addEventListener('click', () => closeManager({ restoreFocus: true }));
	header.append(title, close);
	const toolbar = document.createElement('div');
	toolbar.className = 'rsm-savedBackup-toolbar';
	const search = document.createElement('input');
	search.type = 'search';
	search.className = 'rsm-savedBackup-search';
	search.placeholder = 'Search saved posts and comments';
	search.setAttribute('aria-label', 'Search saved posts and comments');
	const tagFilter = document.createElement('select');
	tagFilter.className = 'rsm-savedBackup-tag-filter';
	tagFilter.setAttribute('aria-label', 'Filter saved content by tag');
	const sync = makeButton('Sync Reddit saved items', 'rsm-savedBackup-sync');
	const exportButton = makeButton('Export local index', 'rsm-savedBackup-export');
	toolbar.append(search, tagFilter, sync, exportButton);
	const status = document.createElement('p');
	status.className = 'rsm-savedBackup-status';
	status.setAttribute('role', 'status');
	const meta = document.createElement('p');
	meta.className = 'rsm-savedBackup-meta';
	const list = document.createElement('ul');
	list.className = 'rsm-savedBackup-list';
	panel.append(header, toolbar, status, meta, list);
	managerState = { panel, search, tagFilter, sync, status, meta, list };
	search.addEventListener('input', renderRecords);
	tagFilter.addEventListener('change', renderRecords);
	sync.addEventListener('click', () => { syncSavedContent(); });
	exportButton.addEventListener('click', exportSavedContent);
	return panel;
}

async function openManager() {
	if (document.getElementById(PANEL_ID)) {
		closeManager();
		return;
	}
	panelOpen = true;
	const panel = createManagerPanel();
	document.body.append(panel);
	document.addEventListener('keydown', onManagerKeydown, true);
	document.addEventListener('pointerdown', onManagerPointerDown, true);
	try {
		records = await loadSavedRecords();
		if (managerState) managerState.status.textContent = records.length ? 'Local index loaded.' : 'No local index yet.';
		renderRecords();
		const close = panel.querySelector('.rsm-savedBackup-close');
		if (close instanceof HTMLElement) close.focus();
	} catch (error) {
		if (managerState) managerState.status.textContent = `Could not open local saved content: ${String(error && (error: any).message || error)}`;
	}
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
	a.textContent = 'saved manager';
	a.title = 'Browse and tag the local saved-content index';
	a.addEventListener('click', (e: Event) => {
		e.preventDefault();
		openManager();
	});
	if (userbar.firstChild) userbar.append(sep);
	userbar.append(a);
}

module.contentStart = () => {
	injectTrigger();
};
