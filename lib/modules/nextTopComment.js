/* @flow */
// RES-Slim: small button that jumps between top-level comment trees, skipping deep nesting.
// Fills a gap in the existing commentNavigator, which filters comments but doesn't cleanly
// "next sibling". Inspired by CoopCoding's "scroll-to-next-most-outer-comment" userscript.

import { Module } from '../core/module';
import { isPageType, string } from '../utils';

export const module: Module<*> = new Module('nextTopComment');

module.moduleName = 'Next top-level comment button';
module.category = 'commentsCategory';
module.description = 'Adds a floating button on thread pages that jumps to the next top-level comment, skipping deep nested replies.';
module.descriptionRaw = true;
module.include = ['comments'];

function topLevelComments(): HTMLElement[] {
	const site = document.querySelector('.commentarea > .sitetable');
	if (!site) return [];
	return Array.from(site.children).filter(el => el instanceof HTMLElement && el.classList.contains('comment'));
}

function visibleIndex(comments: HTMLElement[]): number {
	const y = window.scrollY + 100;
	for (const [i, comment] of comments.entries()) {
		const rect = comment.getBoundingClientRect();
		const top = rect.top + window.scrollY;
		if (top > y) return i - 1;
	}
	return comments.length - 1;
}

function jump(direction: 1 | -1) {
	const comments = topLevelComments();
	if (!comments.length) return;
	const current = visibleIndex(comments);
	const target = Math.max(0, Math.min(comments.length - 1, current + direction));
	const el = comments[target];
	if (el) {
		const top = el.getBoundingClientRect().top + window.scrollY - 60;
		window.scrollTo({ top, behavior: 'smooth' });
	}
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	const bar = string.html`<div class="res-slim-next-top" style="position:fixed; right:16px; bottom:16px; z-index:9999; display:flex; flex-direction:column; gap:4px;"></div>`;
	const up = string.html`<button title="Previous top-level comment" style="padding:6px 10px;">\u25B2</button>`;
	const down = string.html`<button title="Next top-level comment" style="padding:6px 10px;">\u25BC</button>`;
	up.addEventListener('click', () => jump(-1));
	down.addEventListener('click', () => jump(1));
	bar.append(up, down);
	document.body.append(bar);
};
