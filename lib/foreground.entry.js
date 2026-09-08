/* @flow */

import { RES_DISABLED_HASH, RES_SETTINGS_HASH, RES_SETTINGS_REDIRECT_TO_STANDALONE_HASH } from './constants/urlHashes';
import { init } from './core/init';
import { registerModules } from './core/modules';
import { applyAntiFoucTheme } from './core/theme/antiFouc';
import { migrateLegacyFeatureStores } from './environment/foreground/featureDbMigration';
import { makeModuleErrorEntry } from './utils/moduleErrorLog';
import { recordModuleErrorOnce } from './core/modules/storage';
import { getURL } from './environment/foreground/id';
import * as modules from './modules';

registerModules(Object.values(modules));

const blockers = [];
const cleanupAntiFoucTheme = applyAntiFoucTheme();

if (location.hash === RES_DISABLED_HASH) {
	blockers.push(`Hash ${RES_DISABLED_HASH} disables RES.`);
} else {
	window.addEventListener('hashchange', () => { if (location.hash === RES_DISABLED_HASH) location.reload(); });
}

// Integration tests are performed quicker when redirected to the standalone options page
if (location.hash.startsWith(RES_SETTINGS_REDIRECT_TO_STANDALONE_HASH)) {
	location.href = getURL(`options.html${location.hash.replace(RES_SETTINGS_REDIRECT_TO_STANDALONE_HASH, RES_SETTINGS_HASH)}`);
	blockers.push('Redirecting to the options page.');
}

// Firefox reloads the extension on all active pages when upgrading
// RES doesn't handle that well
if (document.documentElement && document.documentElement.classList.contains('res')) {
	document.documentElement.setAttribute('res-warning', 'This page must be reloaded for RES-Slim to function correctly');
	blockers.push('RES is previously loaded on this page.');
}

if (window !== window.parent && (new URL(location.href)).searchParams.get('embedded') !== 'true') {
	blockers.push('Conditions for running on an embedded page are not met.');
}

if (blockers.length) {
	cleanupAntiFoucTheme();
	console.warn('Preventing initalization of RES:', blockers);
} else {
	// Reddit's own storage is the only place the pre-0.55 data sets exist, and
	// this file only runs on a Reddit page. Not awaited: nothing in startup
	// depends on it, and a copy that fails is retried on the next page load.
	migrateLegacyFeatureStores((storeId, attempts, error) => {
		// Three page loads in a row is no longer something to keep to ourselves.
		// It goes where the support report and the settings console already look,
		// naming the store, so a reader who wonders where their vote history went
		// can find out rather than guess.
		recordModuleErrorOnce(makeModuleErrorEntry('featureData', `migrate:${storeId}`, error))
			.catch(() => { /* the log is a convenience, not the migration */ });
		console.warn(`RES-Slim: could not move ${storeId} into extension storage after ${attempts} attempts`, error);
	}).catch(e => { console.warn('RES-Slim: could not move local feature data into extension storage', e); });
	init();
}
