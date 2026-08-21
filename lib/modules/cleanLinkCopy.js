/* @flow */
// RES-Slim: "copy clean link" — copies a post/comment permalink stripped of
// tracking params (utm_*, ref*, share_id, out.reddit.com wrappers). Complements
// outboundCleanser, which rewrites links in place; this is an explicit copy
// action. Inspired by RedditEnhancer v3.1.0 "Clean Link". Disabled by default.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { toCleanLink } from '../utils/outboundCleanser';

export const module: Module<{ [string]: any }> = new Module('cleanLinkCopy');

module.moduleName = 'Copy clean link';
module.category = 'productivityCategory';
module.description = 'Adds a "clean link" button to posts and comments that copies the permalink with tracking parameters (utm_*, ref, share_id, out.reddit.com wrappers) removed.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'profile'];
module.disabledByDefault = true;
module.keywords = ['clean', 'link', 'copy', 'tracking', 'utm', 'share', 'permalink'];

const BTN_CLASS = 'rsm-clean-link-btn';

function permalinkFor(el: HTMLElement): ?string {
	const anchor = el.querySelector('.flat-list.buttons a.bylink') ||
		el.querySelector(':scope > .entry .flat-list.buttons a.comments');
	return anchor instanceof HTMLAnchorElement ? anchor.href : null;
}

function inject(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const buttons = el.querySelector(':scope > .entry .flat-list.buttons');
	if (!(buttons instanceof HTMLElement) || buttons.querySelector(`.${BTN_CLASS}`)) return;
	const href = permalinkFor(el);
	if (!href) return;

	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = BTN_CLASS;
	a.textContent = 'clean link';
	a.title = 'Copy this link without tracking parameters';
	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		const clean = toCleanLink(href, `${location.origin}/`);
		if (!clean) { a.textContent = 'copy failed'; return; }
		try {
			await navigator.clipboard.writeText(clean);
			a.textContent = 'copied!';
		} catch (err) {
			a.textContent = 'copy failed';
		}
		setTimeout(() => { a.textContent = 'clean link'; }, 1500);
	});
	li.append(a);
	buttons.append(li);
}

module.go = () => {
	watchForThings(['post', 'comment'], inject);
};
