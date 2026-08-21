/* @flow */
// RES-Slim: hide comments whose entire body is a single giphy/tenor/i.redd.it image —
// a common low-effort karma-farming pattern.
// Inspired by refriedfood's "Reddit GIF Comment Hider" userscript.

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';

export const module: Module<{ [string]: any }> = new Module('hideGifComments');

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
		if (!(md instanceof HTMLElement) || !isGifOnly(md)) return;
		// Just adding .collapsed does NOT trigger Reddit's native collapse — on
		// old.reddit the collapsed state is driven by a JS click handler that
		// rewrites the DOM into a one-line stub AND adds .collapsed. We need to
		// click the expand toggle to get both halves. Only click if the comment
		// isn't already collapsed (otherwise we'd re-expand it).
		if (thing.element.classList.contains('collapsed')) return;
		const expandToggle: ?HTMLElement = (thing.element.querySelector(':scope > .entry .tagline > .expand'): any);
		if (expandToggle) expandToggle.click();
		else thing.element.classList.add('collapsed');
	});
};
