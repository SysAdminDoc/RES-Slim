/* @flow */

import { Module } from '../core/module';
import * as Modules from '../core/modules';
import { appType, BodyClasses } from '../utils';

export const module: Module<{ [string]: any }> = new Module('nightMode');

module.moduleName = 'nightModeName';
module.category = 'appearanceCategory';
module.description = 'nightModeDesc';
module.options = {
	nightModeOn: {
		type: 'boolean',
		value: true,
		description: 'nightModeNightModeOnDesc',
		title: 'nightModeNightModeOnTitle',
	},
	coloredLinks: {
		type: 'boolean',
		bodyClass: true,
		value: false,
		description: 'nightModeColoredLinksDesc',
		title: 'nightModeColoredLinksTitle',
	},
};

const localStorageKey = 'RES_nightMode';

export const nightModeActive = () =>
	typeof localStorage === 'object' && !!localStorage.getItem(localStorageKey);

// Upstream exposes these for other modules (e.g. showImages) to check compat.
// RES-Slim keeps them as no-op stubs so imports keep working.
export const compatibleSubredditStyle: Promise<boolean> = Promise.resolve(true);
export const onUpdate: Array<void => (void | Promise<void>)> = [];
export function toggledSubredditStyle(toggledOn: boolean): void {
	if (toggledOn) {
		return undefined;
	}

	return undefined;
}

// Current Reddit gets both names, not just its own. `res-d2x-nightmode` styles
// exactly one rule (`_nightMode.scss:1646`); everything a reader actually sees
// dark on that renderer - the toast, the dialogs, the hover cards, the comment
// navigator - is scoped to `.res-nightmode`, and it only ever got that class by
// accident, from the anti-FOUC guard at document_start. So the on state was
// carried by a class this module did not own, and toggling night mode on later in
// the page's life would have painted a light toast over a dark page.
const classNames = () => (appType() === 'd2x' ? ['res-nightmode', 'res-d2x-nightmode'] : ['res-nightmode']);

const addStyle = () => BodyClasses.add(...classNames());
// Both names on every renderer, for the mirror-image reason: the guard writes
// `res-nightmode` onto `<html>` on current Reddit too, so removing only
// `res-d2x-nightmode` left the r2 class behind for the life of the document and
// every `.res-nightmode` rule kept applying with night mode switched off.
const removeStyle = () => BodyClasses.remove('res-nightmode', 'res-d2x-nightmode');

const refreshStyle = () => {
	if (Modules.isRunning(module) && module.options.nightModeOn.value) {
		addStyle();
		localStorage.setItem(localStorageKey, 'true');
	} else {
		removeStyle();
		localStorage.removeItem(localStorageKey);
	}
};

module.onInit = () => {
	// Apply body class as early as possible to avoid FOUC.
	if (nightModeActive()) addStyle();
};

module.always = () => {
	refreshStyle();
};
