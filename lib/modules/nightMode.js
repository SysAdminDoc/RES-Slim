/* @flow */

import { Module } from '../core/module';
import * as Modules from '../core/modules';
import { appType, BodyClasses } from '../utils';

export const module: Module<*> = new Module('nightMode');

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
export async function toggledSubredditStyle(_toggledOn: boolean): Promise<void> {}

const className = () => {
	switch (appType()) {
		case 'r2':
		case 'options':
			return 'res-nightmode';
		case 'd2x':
			return 'res-d2x-nightmode';
		default:
			return 'res-nightmode';
	}
};

const addStyle = () => BodyClasses.add(className());
const removeStyle = () => BodyClasses.remove(className());

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
