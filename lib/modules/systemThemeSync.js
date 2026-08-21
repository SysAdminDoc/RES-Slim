/* @flow */
// RES-Slim: follow the operating system's light/dark preference.
//
// Concept shared by "Reddit Auto Dark Mode", "Reddit Automatic Dark Mode",
// "Reddit Dark Theme Sync" and "Reddit Auto Night Mode" — between them the
// largest single cluster of reddit appearance userscripts. All four toggle
// reddit's own redesign theme, which does not exist on old.reddit; this drives
// RES-Slim's own nightMode instead, and keeps following the OS while the tab is
// open rather than only sampling once at load.

import { Module } from '../core/module';
import * as Modules from '../core/modules';
import { decideNightMode } from '../utils/systemTheme';
import { module as nightMode } from './nightMode';

export const module: Module<{ [string]: any }> = new Module('systemThemeSync');

module.moduleName = 'Follow system theme';
module.category = 'appearanceCategory';
module.description = 'Turns night mode on and off to match your operating system\'s light/dark setting, and keeps following it while the tab stays open. Overrides the night mode toggle while enabled.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.disabledByDefault = true;
module.keywords = ['dark', 'light', 'theme', 'system', 'auto', 'night', 'prefers-color-scheme'];

module.options = {
	direction: {
		type: 'enum',
		value: 'both',
		values: [
			{ name: 'Follow the system in both directions', value: 'both' },
			{ name: 'Only switch to dark, never back to light', value: 'darkOnly' },
		],
		title: 'Direction',
		description: 'Dark-only is for people whose OS flips to light during the day but who never want a light reddit.',
	},
};

const NIGHT_STORAGE_KEY = 'RES_nightMode';

function query(): ?MediaQueryList {
	if (typeof matchMedia !== 'function') return null;
	return matchMedia('(prefers-color-scheme: dark)');
}

// nightMode owns both the body class and the localStorage flag it reads at
// document_start to avoid a flash of the wrong theme. Writing the option alone
// would not survive a reload, and writing the class alone would flash on the
// next page, so both have to move together.
function applyNightMode(on: boolean, signal: AbortSignal) {
	if (nightMode.options.nightModeOn.value === on) return;
	nightMode.options.nightModeOn.value = on;

	try {
		if (on) localStorage.setItem(NIGHT_STORAGE_KEY, 'true');
		else localStorage.removeItem(NIGHT_STORAGE_KEY);
	} catch (e) {
		// Private-mode storage refusal. The body class below still applies for
		// this page load; only the anti-flash hint on the next one is lost.
	}

	if (typeof nightMode.always === 'function') nightMode.always(signal);
}

function sync(signal: AbortSignal) {
	const mq = query();
	if (!mq) return;
	if (!Modules.isRunning(nightMode)) return;
	applyNightMode(decideNightMode(mq.matches, module.options.direction.value, nightMode.options.nightModeOn.value === true), signal);
}

module.always = signal => {
	if (!Modules.isRunning(module)) return;
	sync(signal);

	const mq = query();
	if (!mq || (module: any)._rsmSystemThemeBound) return;
	(module: any)._rsmSystemThemeBound = true;
	// addEventListener rather than the deprecated addListener: Firefox 115 and
	// Chrome 114, the fork's floors, both support it.
	const onChange = () => { sync(signal); };
	mq.addEventListener('change', onChange);
	signal.addEventListener('abort', () => { mq.removeEventListener('change', onChange); }, { once: true });
};
