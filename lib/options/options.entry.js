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

// What the reader looks at until the console is on screen. Removed rather than
// hidden, so nothing is left behind the console for a screen reader to find.
const bootPanel = document.getElementById('RESOptionsBoot');

// Standalone there is no parent listening -- `window.parent` is this window --
// so `failedToLoad` went nowhere and the tab stayed blank forever. The reader is
// looking at this document, so this document has to say what happened.
//
// Not gated on being standalone, although that is the case it was written for.
// Embedded, `settingsNavigation` hears `failedToLoad`, opens the console in a
// tab and closes the frame, so this is invisible there -- and until that
// happens, which is a ten-second timeout when the frame simply never reports,
// the frame says it is loading rather than showing a white rectangle. A branch
// that changes nothing a reader can see is a branch a test cannot hold.
function reportBootFailure(error) {
	if (!bootPanel) return;

	const title = document.getElementById('RESOptionsBootTitle');
	const detail = document.getElementById('RESOptionsBootDetail');
	const reload = document.getElementById('RESOptionsBootReload');

	bootPanel.classList.add('is-error');
	// From a status to an alert, because by now it is one.
	bootPanel.setAttribute('role', 'alert');
	if (title) title.textContent = 'Your settings could not be loaded';
	// The reason, not a shrug. It is the only thing that distinguishes a full
	// storage quota from a corrupt profile from an extension that failed to
	// update, and it is what a reader can act on or report.
	if (detail) detail.textContent = (error && error.message) || String(error);
	if (reload instanceof HTMLButtonElement) {
		reload.hidden = false;
		reload.addEventListener('click', () => { window.location.reload(); });
	}
}

// The options page depends on the context object in order to generate correct links and perform requests against Reddit
Context.retrieveFromParent().then(async () => {
	allowedModules.push('nightMode', 'notifications');

	Core.init();

	await Promise.all([Core.loadI18n, Core.loadOptions]);

	SettingsConsole.start();
	if (bootPanel) bootPanel.remove();

	// Signal to settingsNavigation that it seems to be going well. Addressed to
	// the page that opened the frame, the way every inbound message here is
	// origin-checked. Standalone there is no parent and nothing is listening, so
	// the message goes nowhere either way.
	window.parent.postMessage({ loadSuccess: true }, Context.data.origin);
}).catch(e => {
	console.error(e);
	reportBootFailure(e);
	window.parent.postMessage({ failedToLoad: true }, Context.data.origin);
});
