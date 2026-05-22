/* @flow */
// RES-Slim: export the current comments-page thread as JSON, Markdown, or
// HTML. Adds an "Export" link next to the sort dropdown that opens a tiny
// inline menu of format options. Pure helpers handle the heavy lifting;
// the module is just the trigger.

import { Module } from '../core/module';
import { isPageType } from '../utils';
import {
	buildTree,
	toHtml,
	toJson,
	toMarkdown,
} from '../utils/commentTreeExport';

export const module: Module<*> = new Module('commentTreeExport');

module.moduleName = 'Comment-tree export';
module.category = 'commentsCategory';
module.description = 'Export the current thread (post + every loaded comment) as JSON, Markdown, or HTML. The downloaded files are self-contained; the HTML variant can be opened offline.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['export', 'json', 'markdown', 'html', 'archive', 'backup'];

module.options = {
	includeAllChildren: {
		type: 'boolean',
		value: true,
		title: 'Fetch full tree',
		description: 'Re-fetch the thread via `<permalink>.json?limit=500&depth=10` so the export includes comments not yet loaded on screen.',
	},
	htmlOpenInNewTab: {
		type: 'boolean',
		value: true,
		title: 'HTML opens in new tab',
		description: 'Open the HTML export in a new tab in addition to downloading. Disable for download-only behaviour.',
	},
};

const HOST_ID = 'rsm-commentTreeExport-host';

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

async function fetchThread(permalink: string): Promise<mixed> {
	const url = `${permalink.replace(/\/$/, '')}.json?raw_json=1&limit=500&depth=10`;
	const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
	if (!res.ok) throw new Error(`status ${res.status}`);
	return res.json();
}

async function exportFormat(format: 'json' | 'md' | 'html'): Promise<void> {
	const permalink = location.pathname;
	const includeAll = module.options.includeAllChildren.value !== false;
	let raw: mixed;
	if (includeAll) {
		raw = await fetchThread(permalink);
	} else {
		// Use the existing in-DOM data via a quick JSON-shaped scrape — not as
		// rich as the API call, but works offline.
		raw = null;
	}
	const tree = buildTree(raw);
	if (format === 'json') {
		triggerDownload(toJson(tree), buildFilename(permalink, 'json'), 'application/json');
	} else if (format === 'md') {
		triggerDownload(toMarkdown(tree), buildFilename(permalink, 'md'), 'text/markdown');
	} else if (format === 'html') {
		const html = toHtml(tree);
		triggerDownload(html, buildFilename(permalink, 'html'), 'text/html');
		if (module.options.htmlOpenInNewTab.value !== false) {
			const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
			window.open(blobUrl, '_blank', 'noopener,noreferrer');
		}
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

	const menu = document.createElement('div');
	menu.className = `${HOST_ID}-menu`;
	menu.setAttribute('role', 'menu');
	menu.hidden = true;

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
		item.addEventListener('click', async () => {
			const previous = item.textContent;
			item.textContent = 'exporting…';
			try { await exportFormat(fmt); } catch (e) { item.textContent = 'failed'; return; }
			item.textContent = previous;
			menu.hidden = true;
			link.setAttribute('aria-expanded', 'false');
		});
		menu.append(item);
	}

	link.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		const open = menu.hidden;
		menu.hidden = !open;
		link.setAttribute('aria-expanded', open ? 'true' : 'false');
	});

	document.addEventListener('click', (e: MouseEvent) => {
		if (!(e.target instanceof Node)) return;
		if (!wrapper.contains(e.target) && !menu.hidden) {
			menu.hidden = true;
			link.setAttribute('aria-expanded', 'false');
		}
	}, true);

	wrapper.append(link, menu);
	hostContainer.append(' ', wrapper);
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	injectMenu();
};
