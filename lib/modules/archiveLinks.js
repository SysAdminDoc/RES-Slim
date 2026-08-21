/* @flow */
// RES-Slim: add archive-site shortcut links (Unddit, Reveddit, Wayback Machine)
// on post and comment pages so deleted threads can be retrieved quickly.
// Inspired by jack_the_dripper's "Add Unddit, Reveddit & Wayback Machine Links" (MIT).
// Telemetry pixel from the original is intentionally omitted.

import { Module } from '../core/module';
import { isPageType, string } from '../utils';

export const module: Module<{ [string]: any }> = new Module('archiveLinks');

module.moduleName = 'Archive site links';
module.category = 'productivityCategory';
module.description = 'Adds PullPush, Reveddit, and Wayback Machine buttons on every comment/thread page for quickly opening the current thread in an archive.';
module.descriptionRaw = true;
module.include = ['comments', 'commentsLinklist', 'profile', 'linklist'];
module.options = {
	unddit: {
		type: 'boolean',
		value: true,
		title: 'PullPush',
		description: 'Add a PullPush undelete button (undelete.pullpush.io). The option key stays <code>unddit</code> so existing saved settings are preserved; unddit.com itself has been unreachable for some time and the link has always pointed at PullPush.',
	},
	reveddit: {
		type: 'boolean',
		value: true,
		title: 'Reveddit',
		description: 'Add a Reveddit button.',
	},
	wayback: {
		type: 'boolean',
		value: true,
		title: 'Wayback Machine',
		description: 'Add a Wayback Machine button.',
	},
};

function buildBar(): HTMLElement {
	const bar = string.html`<div class="res-slim-archive-bar" style="margin: 6px 0; padding: 6px; font-size: 12px;"></div>`;
	const here = location.href;
	const undditHref = here.replace(/^https?:\/\/(?:old|www|np)\.reddit\.com/, 'https://undelete.pullpush.io');
	const revedditHref = here.replace(/^https?:\/\/(?:old|www|np)\.reddit\.com/, 'https://www.reveddit.com');
	const waybackHref = `https://web.archive.org/web/*/${here}`;

	if (module.options.unddit.value) {
		bar.append(string.html`<a href="${undditHref}" target="_blank" rel="noopener" style="margin-right: 8px;">PullPush</a>`);
	}
	if (module.options.reveddit.value) {
		bar.append(string.html`<a href="${revedditHref}" target="_blank" rel="noopener" style="margin-right: 8px;">Reveddit</a>`);
	}
	if (module.options.wayback.value) {
		bar.append(string.html`<a href="${waybackHref}" target="_blank" rel="noopener" style="margin-right: 8px;">Wayback</a>`);
	}
	return bar;
}

module.contentStart = () => {
	if (!isPageType('comments', 'commentsLinklist', 'profile', 'linklist')) return;
	const target = document.querySelector('.commentarea, .sitetable.linklisting');
	if (!target || !target.parentNode) return;
	target.parentNode.insertBefore(buildBar(), target);
};
