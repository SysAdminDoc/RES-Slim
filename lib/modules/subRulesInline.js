/* @flow */

import { Module } from '../core/module';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { watchForElements } from '../utils';
import { fetchRules, formatRulesHtml } from '../utils/subRules';

export const module: Module<*> = new Module('subRulesInline');

module.moduleName = 'Subreddit rules hovercard';
module.category = 'subredditsCategory';
module.description = 'Hover over a subreddit link to see its posting rules inline. Fetches /about/rules.json with 24h cache.';
module.descriptionRaw = true;
module.include = ['linklist', 'comments', 'profile', 'wiki'];
module.disabledByDefault = true;
module.keywords = ['rules', 'subreddit', 'hover', 'tooltip'];

const PROCESSED = 'data-rsm-subrules';

let activePopover: ?HTMLElement = null;
let hideTimer: ?TimeoutID = null;

function removePopover() {
	if (activePopover) {
		activePopover.remove();
		activePopover = null;
	}
}

function scheduleHide() {
	clearTimeout(hideTimer);
	hideTimer = setTimeout(removePopover, 300);
}

function cancelHide() {
	clearTimeout(hideTimer);
}

module.go = () => {
	watchForElements(['page'], 'a.subreddit', (anchor: HTMLAnchorElement) => {
		if (anchor.hasAttribute(PROCESSED)) return;
		anchor.setAttribute(PROCESSED, '1');

		const match = anchor.pathname.match(/^\/r\/([\w-]+)\/?$/);
		if (!match) return;
		const sub = match[1];

		let popover: ?HTMLElement = null;

		anchor.addEventListener('mouseenter', async () => {
			cancelHide();
			removePopover();

			popover = document.createElement('div');
			popover.className = 'rsm-subrules-popover';
			setTrustedHTML(popover, '<div class="rsm-subrules-loading">loading rules...</div>');

			const rect = anchor.getBoundingClientRect();
			popover.style.position = 'fixed';
			popover.style.left = `${rect.left}px`;
			popover.style.top = `${rect.bottom + 4}px`;

			popover.addEventListener('mouseenter', cancelHide);
			popover.addEventListener('mouseleave', scheduleHide);

			document.body.append(popover);
			activePopover = popover;

			try {
				const rules = await fetchRules(sub);
				if (popover === activePopover) {
					setTrustedHTML(popover, formatRulesHtml(rules, sub));
				}
			} catch {
				if (popover === activePopover) {
					setTrustedHTML(popover, '<div class="rsm-subrules-empty">Could not load rules</div>');
				}
			}
		});

		anchor.addEventListener('mouseleave', scheduleHide);
	});
};
