/* @flow */
// RES-Slim: auto-collapse comments authored by known bots (AutoModerator,
// RemindMeBot, etc.) and badge AutoMod sticky comments so the reader can see
// at a glance which thread metadata was added by automation.
//
// Pairs with filterRules (v0.10.0) and userTagger (v0.10.1). The bot list is
// editable; the matching is name-based since reddit doesn't expose a bot flag.

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';
import { DEFAULT_BOTS, isAutoModSticky, isBot, parseBotList } from '../utils/botList';

export const module: Module<*> = new Module('botCollapse');

module.moduleName = 'Bot collapse + AutoMod attribution';
module.category = 'commentsCategory';
module.description = 'Auto-collapse comments by known bots (AutoModerator, RemindMeBot, etc.) and badge AutoMod sticky comments. Bot list is editable.';
module.descriptionRaw = true;
module.include = ['comments'];
module.disabledByDefault = true;
module.keywords = ['bot', 'automod', 'collapse', 'spam', 'sticky'];

module.options = {
	botList: {
		type: 'text',
		value: DEFAULT_BOTS.join(', '),
		title: 'Bot usernames',
		description: 'Comma-separated or JSON array of bot usernames to collapse. Default list covers AutoMod + the most common reddit bots.',
	},
	collapseStickyAutomod: {
		type: 'boolean',
		value: true,
		title: 'Collapse AutoMod sticky comments',
		description: 'Sticky AutoMod comments are often boilerplate rules. Collapse them by default.',
	},
	collapseOtherBots: {
		type: 'boolean',
		value: true,
		title: 'Collapse other bot comments',
		description: 'Collapse non-sticky bot comments anywhere in the tree.',
	},
	attributeAutoMod: {
		type: 'boolean',
		value: true,
		title: 'Badge AutoMod sticky comments',
		description: 'Visible "AutoMod" badge on stickied AutoModerator comments even when not collapsed.',
	},
};

const BADGE_CLASS = 'rsm-botCollapse-badge';
const REVEAL_CLASS = 'rsm-botCollapse-reveal';
const MARK_ATTR = 'data-rsm-bot-collapsed';

function commentIsStickied(el: HTMLElement): boolean {
	if (el.classList.contains('stickied')) return true;
	if (el.getAttribute('data-stickied') === 'true') return true;
	return false;
}

function clickExpandIfPresent(el: HTMLElement): void {
	if (el.classList.contains('collapsed')) return;
	const expand: ?HTMLElement = (el.querySelector(':scope > .entry .tagline > .expand'): any);
	if (expand) expand.click();
	else el.classList.add('collapsed');
}

function clickCollapseIfPresent(el: HTMLElement): void {
	if (!el.classList.contains('collapsed')) return;
	const expand: ?HTMLElement = (el.querySelector(':scope > .entry .tagline > .expand'): any);
	if (expand) expand.click();
	else el.classList.remove('collapsed');
}

function injectBadge(el: HTMLElement, label: string, kind: 'automod' | 'bot'): void {
	const tagline = el.querySelector(':scope > .entry .tagline');
	if (!(tagline instanceof HTMLElement)) return;
	if (tagline.querySelector(`:scope > .${BADGE_CLASS}`)) return;
	const badge = document.createElement('span');
	badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${kind}`;
	badge.textContent = label;
	badge.title = kind === 'automod' ? 'Stickied by AutoModerator' : 'Comment by a known bot';
	tagline.append(' ', badge);
}

function injectReveal(el: HTMLElement): void {
	const tagline = el.querySelector(':scope > .entry .tagline');
	if (!(tagline instanceof HTMLElement)) return;
	if (tagline.querySelector(`:scope > .${REVEAL_CLASS}`)) return;
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = REVEAL_CLASS;
	btn.textContent = 'reveal';
	btn.title = 'Toggle bot collapse';
	btn.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (el.getAttribute(MARK_ATTR) === '1') {
			clickCollapseIfPresent(el);
			el.removeAttribute(MARK_ATTR);
			btn.textContent = 'collapse';
		} else {
			clickExpandIfPresent(el);
			el.setAttribute(MARK_ATTR, '1');
			btn.textContent = 'reveal';
		}
	});
	tagline.append(' ', btn);
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	const list = parseBotList(module.options.botList.value);
	if (!list.length) return;
	const collapseSticky = module.options.collapseStickyAutomod.value !== false;
	const collapseOthers = module.options.collapseOtherBots.value !== false;
	const attribute = module.options.attributeAutoMod.value !== false;

	watchForThings(['comment'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		const author = el.getAttribute('data-author');
		if (!author) return;
		const stickied = commentIsStickied(el);
		const automodSticky = isAutoModSticky(author, stickied);
		const knownBot = isBot(author, list);

		if (automodSticky && attribute) injectBadge(el, 'AutoMod', 'automod');
		else if (knownBot && !automodSticky) injectBadge(el, 'bot', 'bot');

		let shouldCollapse = false;
		if (automodSticky && collapseSticky) shouldCollapse = true;
		else if (knownBot && collapseOthers) shouldCollapse = true;

		if (shouldCollapse) {
			clickExpandIfPresent(el);
			el.setAttribute(MARK_ATTR, '1');
			injectReveal(el);
		}
	});
};
