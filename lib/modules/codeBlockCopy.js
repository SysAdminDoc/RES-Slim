/* @flow */

import { Module } from '../core/module';
import { watchForElements } from '../utils';

export const module: Module<{ [string]: any }> = new Module('codeBlockCopy');

module.moduleName = 'Code block copy button';
module.category = 'commentsCategory';
module.description = 'Adds a copy-to-clipboard button on code blocks in posts and comments.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'wiki', 'profile'];
module.disabledByDefault = true;
module.keywords = ['code', 'copy', 'clipboard', 'pre', 'block'];

const PROCESSED = 'data-rsm-code-copy';

module.go = () => {
	watchForElements(['page'], '.md pre', (pre: HTMLElement) => {
		if (pre.hasAttribute(PROCESSED)) return;
		pre.setAttribute(PROCESSED, '1');

		const code = pre.querySelector('code');
		if (!code) return;

		pre.style.position = 'relative';

		const btn = document.createElement('button');
		btn.className = 'rsm-code-copy-btn';
		btn.textContent = 'copy';
		btn.type = 'button';
		// Every code block on the page produces a button reading 'copy', so the
		// visible label is not a usable name on its own. The button also reports its
		// own outcome by rewriting that label, which is silent without a live region.
		btn.setAttribute('aria-label', 'Copy this code block to the clipboard');
		btn.setAttribute('aria-live', 'polite');
		btn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(code.textContent || '');
				btn.textContent = 'copied';
			} catch {
				btn.textContent = 'copy failed';
			}
			setTimeout(() => { btn.textContent = 'copy'; }, 1500);
		});

		pre.append(btn);
	});
};
