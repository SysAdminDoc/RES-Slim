/* @flow */

import { Module } from '../core/module';
import { i18n } from '../environment';
import { addFloater, string } from '../utils';
import * as SettingsNavigation from './settingsNavigation';

export const module: Module<*> = new Module('RESMenu');

module.moduleName = 'menuName';
module.category = 'coreCategory';
module.description = 'The <span class="gearIcon"></span> button that opens the RES settings console';
module.descriptionRaw = true;
module.alwaysEnabled = true;

let gear;

module.contentStart = () => {
	gear = string.html`<span id="RESSettingsButton" style="cursor: pointer" title="${i18n('RESSettings')}" class="gearIcon"></span>`;

	gear.addEventListener('click', () => {
		SettingsNavigation.open();
	});

	addFloater(gear, { order: 5, container: 'inNavbar' });
};

module.afterLoad = () => {
	requestAnimationFrame(addLegacyStyling);
};

// Kept as a no-op so existing callers (e.g. settingsNavigation.beforeLoad) don't error.
// RES-Slim gear click opens the settings console directly instead of a dropdown.
export function addMenuItem(_getElement: () => HTMLElement, _onClick: (e: Event) => void = () => {}, _order: number = 0) {}

function addLegacyStyling() {
	const { backgroundImage } = window.getComputedStyle(gear);
	if (backgroundImage && backgroundImage !== 'none') {
		gear.classList.add('res-gearIcon-legacy');
	}
}
