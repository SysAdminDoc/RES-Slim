/* @flow */
// RES-Slim: give every username a stable colour so you can follow one person
// through a long thread without reading the name each time.
//
// Rewritten from the concept in "Colorfull reddit usernames (CRU)" (Greasy Fork
// 5722). The original re-randomises on each load and can emit unreadable
// colours; see lib/utils/usernameColors.js for why only the hue is derived from
// the name here.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { colorForUsername, isReservedName } from '../utils/usernameColors';

export const module: Module<{ [string]: any }> = new Module('usernameColors');

module.moduleName = 'Colour usernames';
module.category = 'usersCategory';
module.description = 'Gives every author a stable colour derived from their name, so the same person is recognisable at a glance through a long thread. The colour never changes between page loads.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'commentsLinklist', 'profile', 'search', 'inbox'];
module.disabledByDefault = true;
module.keywords = ['username', 'colour', 'color', 'author', 'highlight'];

module.options = {
	colorComments: {
		type: 'boolean',
		value: true,
		title: 'Colour comment authors',
		description: 'Apply the colour to author links in comment taglines.',
	},
	colorPosts: {
		type: 'boolean',
		value: true,
		title: 'Colour post authors',
		description: 'Apply the colour to author links on listing and search pages.',
	},
	palette: {
		type: 'enum',
		value: 'dark',
		values: [
			{ name: 'For a dark page (light text)', value: 'dark' },
			{ name: 'For a light page (dark text)', value: 'light' },
		],
		title: 'Palette',
		description: 'Pick the band that contrasts with the background you actually browse on. Both bands clear WCAG AA against their own background.',
	},
	saturation: {
		type: 'text',
		value: '62',
		title: 'Saturation (%)',
		description: 'Higher is more vivid. 0 renders every name the same grey, which defeats the point.',
	},
	boldAuthor: {
		type: 'boolean',
		value: false,
		title: 'Also bold the name',
		description: 'Useful when the colour alone is too subtle at small sizes.',
	},
};

const ATTR = 'data-rsm-username-colored';

function paint(link: HTMLAnchorElement, name: string) {
	if (link.hasAttribute(ATTR)) return;
	link.setAttribute(ATTR, '1');

	const saturation = parseInt(module.options.saturation.value, 10);
	link.style.color = colorForUsername(name, {
		dark: module.options.palette.value !== 'light',
		saturation: Number.isFinite(saturation) ? Math.min(100, Math.max(0, saturation)) : undefined,
	});
	if (module.options.boldAuthor.value) link.style.fontWeight = '600';
}

function processThing(thing: Thing) {
	const isComment = thing.isComment();
	if (isComment && !module.options.colorComments.value) return;
	if (!isComment && !module.options.colorPosts.value) return;

	const link = thing.getAuthorElement();
	if (!(link instanceof HTMLAnchorElement)) return;

	// The tagline also carries submitter/mod/admin classes that old.reddit and
	// roleHighlights colour deliberately. Overwriting those loses information the
	// user asked for, so leave them alone.
	if (link.classList.contains('submitter') || link.classList.contains('moderator') || link.classList.contains('admin') || link.classList.contains('friend')) return;

	const name = thing.getAuthor();
	if (!name || isReservedName(name)) return;

	paint(link, name);
}

module.contentStart = () => {
	watchForThings(['post', 'comment'], processThing);
};
