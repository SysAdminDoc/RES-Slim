/* @flow */
// RES-Slim: auto-click "[+] show more" / "continue this thread" / threshold-hidden
// comment stubs on thread load. Written fresh based on the concept in ludios/expand-everything
// to stay clear of its AGPL-3.0 license.

import { Module } from '../core/module';
import { isPageType, watchForElements } from '../utils';

export const module: Module<*> = new Module('autoExpand');

module.moduleName = 'Auto-expand collapsed comments';
module.category = 'commentsCategory';
module.description = 'Automatically expands comments collapsed by the "below threshold" filter, so you don\'t have to click each one.';
module.descriptionRaw = true;
module.include = ['comments'];
module.options = {
	expandBelowThreshold: {
		type: 'boolean',
		value: true,
		title: 'Expand "below threshold" comments',
		description: 'Auto-expand comments that Reddit collapses because their score is below your threshold.',
	},
	expandDeletedStubs: {
		type: 'boolean',
		value: true,
		title: 'Expand [deleted] stubs',
		description: 'Show the deleted/removed comment placeholder instead of collapsing it.',
	},
};

function expand(comment: HTMLElement) {
	if (!comment.classList.contains('collapsed')) return;
	const expandLink: ?HTMLElement = (comment.querySelector(':scope > .entry .expand'): any);
	if (expandLink) expandLink.click();
}

function shouldExpand(comment: HTMLElement): boolean {
	if (module.options.expandBelowThreshold.value && comment.classList.contains('collapsed')) {
		// Reddit marks these with the .noncollapsed:has(> .entry .tagline > .score.dislikes) pattern,
		// but the simplest signal is: still collapsed after render.
		return true;
	}
	if (module.options.expandDeletedStubs.value) {
		const md = comment.querySelector(':scope > .entry .md');
		if (md && /^\[(deleted|removed)\]/.test(md.textContent || '')) return true;
	}
	return false;
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	const run = (el: HTMLElement) => { if (shouldExpand(el)) expand(el); };
	document.querySelectorAll('.comment.collapsed').forEach(c => {
		if (c instanceof HTMLElement) run(c);
	});
	watchForElements(['page'], '.comment.collapsed', run);
};
