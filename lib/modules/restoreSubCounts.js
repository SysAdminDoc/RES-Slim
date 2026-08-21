/* @flow */
// RES-Slim: restore subscriber and "currently here" counts on subreddit sidebars.
// Reddit hid these server-rendered counts in late 2024; fetch /r/<sub>/about.json
// and inject the numbers back.
// Inspired by littux "Restore subscriber/online counts :: Reddit" GreasyFork userscript.

import { Module } from '../core/module';
import { currentSubreddit } from '../utils';
import { ajax } from '../environment';
import { getStatusFromError } from '../utils/redditApiStatus';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<{ [string]: any }> = new Module('restoreSubCounts');

module.moduleName = 'Restore subscriber/online counts';
module.category = 'appearanceCategory';
module.description = 'Restores the subscriber count and currently-viewing-here count in the old.reddit sidebar. Reddit removed them from the server-rendered page in late 2024.';
module.descriptionRaw = true;
module.include = ['r2'];

module.contentStart = async () => {
	const sub = currentSubreddit();
	if (!sub) return;

	// Wait a tick for the sidebar to render.
	await new Promise(resolve => {
		requestAnimationFrame(() => {
			resolve();
		});
	});

	const sidebar = document.querySelector('.side .titlebox');
	if (!sidebar) return;

	// Skip if the counts are already present.
	if (sidebar.querySelector('.res-slim-sub-counts')) return;

	try {
		const data: any = await ajax({
			url: `/r/${sub}/about.json`,
			type: 'json',
			cacheFor: 5 * 60 * 1000,
		});
		const info = data && data.data;
		if (!info) return;

		const subscribers = typeof info.subscribers === 'number' ? info.subscribers : null;
		const active = typeof info.active_user_count === 'number' ? info.active_user_count : null;

		const box = document.createElement('div');
		box.className = 'res-slim-sub-counts';
		box.style.padding = '6px 10px';
		box.style.fontSize = '11px';
		box.style.lineHeight = '1.4';
		box.style.borderTop = '1px solid rgba(128,128,128,0.2)';
		const appendLine = (value: number, label: string) => {
			if (box.childNodes.length) box.append(document.createElement('br'));
			const strong = document.createElement('strong');
			strong.textContent = value.toLocaleString();
			box.append(strong, ` ${label}`);
		};
		if (subscribers !== null) appendLine(subscribers, 'subscribers');
		if (active !== null) appendLine(active, 'here now');
		if (!box.childNodes.length) return;

		const titleBoxTitle = sidebar.querySelector('.title');
		if (titleBoxTitle && titleBoxTitle.parentNode) {
			titleBoxTitle.parentNode.insertBefore(box, titleBoxTitle.nextSibling);
		} else {
			sidebar.prepend(box);
		}
	} catch (err) {
		// Surface a Reddit block (403 anonymous-access removal, 429) once instead
		// of silently showing nothing; plain network errors stay quiet.
		notifyRedditApiBlocked(getStatusFromError(err));
	}
};
