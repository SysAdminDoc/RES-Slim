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

export const module: Module<{ [string]: any }> = new Module('botCollapse');

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
		description: 'Comma-separated or JSON array of bot usernames to collapse. Default list covers AutoMod + the most common Reddit bots.',
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

function commentIsStickied(el: HTMLElement): boolean {
	if (el.classList.contains('stickied')) return true;
	if (el.getAttribute('data-stickied') === 'true') return true;
	return false;
}

function setCollapsed(el: HTMLElement, collapse: boolean): void {
	const isCollapsed = el.classList.contains('collapsed');
	if (collapse === isCollapsed) return;
	const expand: ?HTMLElement = (el.querySelector(':scope > .entry .tagline > .expand'): any);
	if (expand) expand.click();
	else el.classList.toggle('collapsed', collapse);
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

function syncRevealLabel(btn: HTMLButtonElement, el: HTMLElement): void {
	const collapsed = el.classList.contains('collapsed');
	btn.textContent = collapsed ? 'reveal' : 'collapse';
	// The label alone reads as a command, not a state. `aria-expanded` is what
	// tells a screen reader whether the comment is currently open, and it has to be
	// kept in sync here because reddit's own [-]/[+] can collapse it behind our back.
	btn.setAttribute('aria-expanded', String(!collapsed));
}

function injectReveal(el: HTMLElement): void {
	const tagline = el.querySelector(':scope > .entry .tagline');
	if (!(tagline instanceof HTMLElement)) return;
	if (tagline.querySelector(`:scope > .${REVEAL_CLASS}`)) return;
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = REVEAL_CLASS;
	btn.title = 'Toggle bot collapse';
	btn.setAttribute('aria-label', 'Toggle collapse for this bot comment');
	syncRevealLabel(btn, el);
	btn.addEventListener('click', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Drive off the live .collapsed class so manual collapses/expands via
		// reddit's native [-]/[+] don't desync the button label.
		setCollapsed(el, !el.classList.contains('collapsed'));
		syncRevealLabel(btn, el);
	});
	// Track external class changes (native toggle, RES-style toggles) so the
	// button label stays accurate without polling.
	const observer = new MutationObserver(() => {
		if (!btn.isConnected) { observer.disconnect(); return; }
		syncRevealLabel(btn, el);
	});
	observer.observe(el, { attributes: true, attributeFilter: ['class'] });
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
			setCollapsed(el, true);
			injectReveal(el);
		}
	});
};
