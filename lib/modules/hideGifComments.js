/* @flow */
// RES-Slim: hide comments whose entire body is a single giphy/tenor/i.redd.it image —
// a common low-effort karma-farming pattern.
// Inspired by refriedfood's "Reddit GIF Comment Hider" userscript.

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';

export const module: Module<*> = new Module('hideGifComments');

module.moduleName = 'Hide GIF-only comments';
module.category = 'commentsCategory';
module.description = 'Collapses comments whose entire content is a single image or GIF from giphy/tenor/i.redd.it/imgur.';
module.descriptionRaw = true;
module.include = ['comments'];
module.options = {
	enabled: {
		type: 'boolean',
		value: true,
		title: 'Enabled',
		description: 'Collapse GIF-only comments on sight.',
	},
};

const imageHostRe = /^https?:\/\/(?:media\d*\.giphy\.com|[a-z0-9]+\.tenor\.com|i\.redd\.it|i\.imgur\.com)\b/i;

function isGifOnly(md: HTMLElement): boolean {
	// Exactly one child paragraph, one child anchor, no other text.
	const text = (md.textContent || '').trim();
	const links = md.querySelectorAll('a');
	if (links.length !== 1) return false;
	const link: HTMLAnchorElement = (links[0]: any);
	if (!imageHostRe.test(link.href)) return false;
	// The link's own text should roughly match the body text.
	return text === (link.textContent || '').trim();
}

module.contentStart = () => {
	if (!isPageType('comments')) return;
	if (!module.options.enabled.value) return;
	watchForThings(['comment'], (thing: Thing) => {
		const md = thing.entry.querySelector('.usertext-body .md');
		if (md instanceof HTMLElement && isGifOnly(md)) {
			thing.element.classList.add('collapsed');
		}
	});
};
