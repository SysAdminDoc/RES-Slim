/* @flow */
// RES-Slim: restore subscriber and "currently here" counts on subreddit sidebars.
// Reddit hid these server-rendered counts in late 2024; fetch /r/<sub>/about.json
// and inject the numbers back.
// Inspired by littux "Restore subscriber/online counts :: Reddit" GreasyFork userscript.

import { Module } from '../core/module';
import { currentSubreddit } from '../utils';
import { ajax } from '../environment';

export const module: Module<*> = new Module('restoreSubCounts');

module.moduleName = 'Restore subscriber/online counts';
module.category = 'appearanceCategory';
module.description = 'Restores the subscriber count and currently-viewing-here count in the old.reddit sidebar. Reddit removed them from the server-rendered page in late 2024.';
module.descriptionRaw = true;

module.contentStart = async () => {
	const sub = currentSubreddit();
	if (!sub) return;

	// Wait a tick for the sidebar to render.
	await new Promise(res => requestAnimationFrame(res));

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
		const parts = [];
		if (subscribers !== null) parts.push(`<strong>${subscribers.toLocaleString()}</strong> subscribers`);
		if (active !== null) parts.push(`<strong>${active.toLocaleString()}</strong> here now`);
		box.innerHTML = parts.join('<br>');

		const titleBoxTitle = sidebar.querySelector('.title');
		if (titleBoxTitle && titleBoxTitle.parentNode) {
			titleBoxTitle.parentNode.insertBefore(box, titleBoxTitle.nextSibling);
		} else {
			sidebar.prepend(box);
		}
	} catch {
		/* ignore network errors */
	}
};
