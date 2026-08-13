/* @flow */
// RES-Slim: export the current comments-page thread as JSON, Markdown, or
// HTML. Adds an "Export" link next to the sort dropdown that opens a tiny
// inline menu of format options. Pure helpers handle the heavy lifting;
// the module is just the trigger.

import { Module } from '../core/module';
import { isPageType } from '../utils';
import { flashStatus } from '../utils/buttonStatus';
import {
	buildTree,
	toHtml,
	toJson,
	toMarkdown,
} from '../utils/commentTreeExport';
import { fetchRedditJson, isRedditListingPair } from '../utils/redditJson';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<*> = new Module('commentTreeExport');

module.moduleName = 'Comment-tree export';
module.category = 'commentsCategory';
module.description = 'Export the current thread (post + every loaded comment) as JSON, Markdown, or HTML. The downloaded files are self-contained; the HTML variant can be opened offline. Fetches `<permalink>.json?limit=500&depth=10` so the export includes comments not yet on screen.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['export', 'json', 'markdown', 'html', 'archive', 'backup'];

module.options = {
	htmlOpenInNewTab: {
		type: 'boolean',
		value: true,
		title: 'HTML opens in new tab',
		description: 'Open the HTML export in a new tab in addition to downloading. Disable for download-only behaviour.',
	},
};

const HOST_ID = 'rsm-commentTreeExport-host';
const MENU_ID = `${HOST_ID}-menu`;

function buildFilename(permalink: string, ext: string): string {
	const slug = (permalink || '').replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 80);
	return `${slug || 'thread'}.${ext}`;
}

function triggerDownload(content: string, filename: string, mime: string): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

function openHtmlPreview(html: string): void {
	const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
	window.open(blobUrl, '_blank', 'noopener,noreferrer');
	setTimeout(() => { URL.revokeObjectURL(blobUrl); }, 60000);
}

function fetchThread(permalink: string): Promise<mixed> {
	const url = `${permalink.replace(/\/$/, '')}.json?raw_json=1&limit=500&depth=10`;
	return fetchRedditJson(url, {
		onStatus: notifyRedditApiBlocked,
		validate: isRedditListingPair,
	});
}

async function exportFormat(format: 'json' | 'md' | 'html'): Promise<void> {
	const permalink = location.pathname;
	const raw = await fetchThread(permalink);
	const tree = buildTree(raw);
	if (format === 'json') {
		triggerDownload(toJson(tree), buildFilename(permalink, 'json'), 'application/json');
		return;
	}
	if (format === 'md') {
		triggerDownload(toMarkdown(tree), buildFilename(permalink, 'md'), 'text/markdown');
		return;
	}
	const html = toHtml(tree);
	triggerDownload(html, buildFilename(permalink, 'html'), 'text/html');
	if (module.options.htmlOpenInNewTab.value !== false) {
		openHtmlPreview(html);
	}
}

function injectMenu(): void {
	if (document.getElementById(HOST_ID)) return;
	const tabmenu = document.querySelector('body.comments-page .menuarea .dropdown.lightdrop');
	const hostContainer = tabmenu instanceof HTMLElement ? tabmenu.parentNode : document.querySelector('body.comments-page .menuarea');
	if (!(hostContainer instanceof HTMLElement)) return;

	const wrapper = document.createElement('span');
	wrapper.id = HOST_ID;

	const link = document.createElement('a');
	link.href = '#';
	link.textContent = 'export ▾';
	link.className = `${HOST_ID}-trigger`;
	link.setAttribute('role', 'button');
	link.setAttribute('aria-haspopup', 'true');
	link.setAttribute('aria-expanded', 'false');
	link.setAttribute('aria-controls', MENU_ID);

	const menu = document.createElement('div');
	menu.id = MENU_ID;
	menu.className = `${HOST_ID}-menu`;
	menu.setAttribute('role', 'menu');
	menu.setAttribute('aria-label', 'Export thread format');
	menu.hidden = true;

	const setOpen = (open: boolean, focusMenu: boolean = false) => {
		menu.hidden = !open;
		link.setAttribute('aria-expanded', open ? 'true' : 'false');
		if (open && focusMenu) {
			const first = menu.querySelector('button');
			if (first instanceof HTMLButtonElement) first.focus();
		}
	};

	const options: $ReadOnlyArray<['json' | 'md' | 'html', string]> = [
		['json', 'JSON'],
		['md', 'Markdown'],
		['html', 'HTML (offline)'],
	];
	for (const [fmt, label] of options) {
		const item = document.createElement('button');
		item.type = 'button';
		item.textContent = label;
		item.setAttribute('role', 'menuitem');
		const restore = label;
		item.addEventListener('click', async () => {
			item.disabled = true;
			item.setAttribute('aria-busy', 'true');
			flashStatus(item, 'exporting…');
			try {
				await exportFormat(fmt);
				flashStatus(item, '✓ done', { restore, durationMs: 3000 });
			} catch (e) {
				flashStatus(item, 'failed', { restore, durationMs: 4000 });
				item.disabled = false;
				item.setAttribute('aria-busy', 'false');
				return;
			}
			item.disabled = false;
			item.setAttribute('aria-busy', 'false');
			setOpen(false);
			link.focus();
		});
		menu.append(item);
	}

	link.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		const open = menu.hidden;
		setOpen(open, open);
	});

	document.addEventListener('click', (e: MouseEvent) => {
		if (!(e.target instanceof Node)) return;
		if (!wrapper.contains(e.target) && !menu.hidden) {
			setOpen(false);
		}
	}, true);

	document.addEventListener('keydown', (e: KeyboardEvent) => {
		if (menu.hidden || e.key !== 'Escape') return;
		e.preventDefault();
		setOpen(false);
		link.focus();
	}, true);

	wrapper.append(link, menu);
	hostContainer.append(' ', wrapper);
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	injectMenu();
};
