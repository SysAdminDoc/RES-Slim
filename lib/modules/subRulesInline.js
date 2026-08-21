/* @flow */

import { Module } from '../core/module';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { watchForElements } from '../utils';
import { fetchRules, formatRulesHtml } from '../utils/subRules';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<{ [string]: any }> = new Module('subRulesInline');

module.moduleName = 'Subreddit rules hovercard';
module.category = 'subredditsCategory';
module.description = 'Hover over a subreddit link to see its posting rules inline. Fetches /about/rules.json with 24h cache.';
module.descriptionRaw = true;
module.include = ['linklist', 'comments', 'profile', 'wiki'];
module.disabledByDefault = true;
module.keywords = ['rules', 'subreddit', 'hover', 'tooltip'];

const PROCESSED = 'data-rsm-subrules';
const POPOVER_ID = 'rsm-subrules-popover';

let activePopover: ?HTMLElement = null;
let activeAnchor: ?HTMLAnchorElement = null;
let hideTimer: ?TimeoutID = null;

function removePopover() {
	if (activeAnchor) {
		activeAnchor.removeAttribute('aria-describedby');
		activeAnchor = null;
	}
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

		const showPopover = async () => {
			cancelHide();
			removePopover();

			popover = document.createElement('div');
			popover.id = POPOVER_ID;
			popover.className = 'rsm-subrules-popover';
			popover.setAttribute('role', 'tooltip');
			setTrustedHTML(popover, '<div class="rsm-subrules-loading" role="status">Loading rules...</div>');

			const rect = anchor.getBoundingClientRect();
			popover.style.position = 'fixed';
			popover.style.left = `${Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 432))}px`;
			popover.style.top = `${rect.bottom > window.innerHeight - 220 ? Math.max(12, rect.top - 220) : rect.bottom + 6}px`;

			popover.addEventListener('mouseenter', cancelHide);
			popover.addEventListener('mouseleave', scheduleHide);

			document.body.append(popover);
			activePopover = popover;
			activeAnchor = anchor;
			anchor.setAttribute('aria-describedby', POPOVER_ID);

			try {
				const rules = await fetchRules(sub, notifyRedditApiBlocked);
				if (popover === activePopover) {
					setTrustedHTML(popover, formatRulesHtml(rules, sub));
				}
			} catch {
				if (popover === activePopover) {
					setTrustedHTML(popover, '<div class="rsm-subrules-empty is-error" role="alert">Could not load rules.</div>');
				}
			}
		};

		const hidePopover = () => {
			scheduleHide();
		};

		anchor.addEventListener('mouseenter', showPopover);
		anchor.addEventListener('focus', showPopover);
		anchor.addEventListener('mouseleave', hidePopover);
		anchor.addEventListener('blur', hidePopover);
	});
};
