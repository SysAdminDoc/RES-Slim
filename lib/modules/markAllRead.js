/* @flow */
// RES-Slim: add a "Mark all read" button to old.reddit's /message/ pages.
// Inspired by Logan Kirkland's "Reddit - Mark All Messages Read" userscript.

import { Module } from '../core/module';
import { isPageType } from '../utils';
import { ajax } from '../environment';

export const module: Module<*> = new Module('markAllRead');

module.moduleName = 'Mark all messages read';
module.category = 'productivityCategory';
module.description = 'Adds a "Mark all read" button on /message/unread and /message/inbox pages for bulk-clearing the inbox.';
module.descriptionRaw = true;
module.include = ['inbox'];

async function markAll(btn: HTMLButtonElement) {
	btn.disabled = true;
	btn.textContent = 'Marking\u2026';
	try {
		const modhash = (document.querySelector('input[name="uh"]'): any)?.value ||
			(window: any).modhash;
		await ajax({
			method: 'POST',
			url: '/api/read_all_messages',
			headers: modhash ? { 'X-Modhash': modhash } : {},
			data: {},
		});
		btn.textContent = 'All marked read \u2713';
		setTimeout(() => { location.reload(); }, 600);
	} catch {
		btn.textContent = 'Failed';
		btn.disabled = false;
	}
}

module.contentStart = () => {
	if (!isPageType('inbox')) return;
	const container = document.querySelector('.menuarea') || document.querySelector('.tabmenu');
	if (!container) return;
	const btn = document.createElement('button');
	btn.textContent = 'Mark all read';
	btn.className = 'res-slim-mark-all-read';
	btn.style.marginLeft = '8px';
	btn.addEventListener('click', () => markAll(btn));
	container.append(btn);
};
