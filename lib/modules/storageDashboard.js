/* @flow */

import { DATA_WORKSPACE_ROUTE } from '../constants/settingsCategories';
import { Module } from '../core/module';
import { makeUrlHash } from './settingsNavigation';

export const module: Module<{ [string]: any }> = new Module('storageDashboard');

module.moduleName = 'Storage dashboard';
module.category = 'coreCategory';
module.description = 'Adds a "storage" link in the userbar that opens the local-data workspace in the settings console, where every local data set can be browsed, searched, exported and purged.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['storage', 'database', 'idb', 'purge', 'data', 'dashboard'];

const TRIGGER_ID = 'rsm-storageDashboard-trigger';

// This used to open a panel of its own: a list of stores, a count each, and a
// purge button. All of that is now the settings console's Data tab, which can
// do it without a Reddit page and can search and export as well — so this is
// the link to it rather than a second, worse copy of it.
module.go = () => {
	const header = document.querySelector('#header-bottom-right');
	if (!header) return;

	const sep = document.createTextNode(' | ');
	const trigger = document.createElement('a');
	trigger.id = TRIGGER_ID;
	// 15px tall in the userbar, under WCAG 2.5.8's 24x24 target.
	trigger.className = 'rsm-target-24';
	// The href is the whole mechanism: `settingsNavigation` intercepts every
	// settings link on the page, and it already leaves a ctrl- or middle-click
	// alone so the console can be opened in a tab.
	trigger.href = makeUrlHash(DATA_WORKSPACE_ROUTE);
	trigger.textContent = 'storage';
	trigger.title = 'Browse, export and purge the data stored on this device';
	header.append(sep, trigger);
};
