/* @flow */

import './handleBlocking';
import * as Context from '../environment/foreground/context';
import * as Core from '../core/init';
import { allowedModules, registerModules } from '../core/modules';
import { module as nightMode } from '../modules/nightMode';
import { module as notifications } from '../modules/notifications';
import { module as search } from '../modules/search';
import { module as settingsNavigation } from '../modules/settingsNavigation';
import * as SettingsConsole from './settingsConsole';
import optionModules from './optionsMetadata';

const runtimeModules = new Map(
	[nightMode, notifications, search, settingsNavigation].map(module => [module.moduleID, module]),
);
registerModules(optionModules.map(module => runtimeModules.get(module.moduleID) || module));

// The options page depends on the context object in order to generate correct links and perform requests against Reddit
Context.retrieveFromParent().then(async () => {
	allowedModules.push('nightMode', 'notifications');

	Core.init();

	await Promise.all([Core.loadI18n, Core.loadOptions]);

	SettingsConsole.start();

	// Signal to settingsNavigation that it seems to be going well
	window.parent.postMessage({ loadSuccess: true }, '*');
}).catch(e => {
	console.error(e);
	window.parent.postMessage({ failedToLoad: true }, '*');
});
