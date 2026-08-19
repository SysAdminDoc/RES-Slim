/* @flow */
// RES-Slim: defuse Reddit's first-party event-tracking pipeline by monkey-patching
// navigator.sendBeacon, fetch, and XMLHttpRequest.open in the page world for a
// curated tracker-host allowlist. Defaults on. Reversible by toggling the module
// off and reloading the page — runtime undo is impossible once the page script
// has executed.
//
// The patching itself is in `lib/pageWorld/trackingSabotage.entry.js`, which
// ships as its own web-accessible file. This used to build the same code as a
// string and assign it to a `<script>`'s `textContent`, and Chrome blocked every
// one of those against the extension's own `script-src 'self'` — so the module
// was default-on and inert for its whole life. A `src` pointing at a packaged
// file is the supported route and is what runs now.

import { Module } from '../core/module';
import { getURL } from '../environment';

export const module: Module<*> = new Module('eventTrackingSabotage');

module.moduleName = 'Event tracking sabotage';
module.category = 'privacyCategory';
module.description = 'Block Reddit\'s first-party event/telemetry beacons before the page can build them. The packaged request rules already block the same destinations at the network layer; this stops the payload being assembled at all, and covers transports those rules do not. Reload required to undo per-page.';
module.descriptionRaw = true;
// Both renderers: this patches `sendBeacon`/`fetch`/`XMLHttpRequest` in the page
// world and never touches the DOM, so it is renderer-agnostic by construction -
// and current Reddit sends considerably more telemetry to these same hosts than
// old Reddit does.
module.include = ['r2', 'd2x'];
module.keywords = ['privacy', 'tracking', 'beacon', 'analytics', 'telemetry', 'event'];

module.options = {
	logBlocked: {
		type: 'boolean',
		value: false,
		title: 'Log blocked beacons to the console',
		description: 'Verbose. Useful for verifying the sabotage is firing.',
	},
};

const PAGE_SCRIPT = 'trackingSabotage.entry.js';

let injected = false;

module.contentStart = () => {
	if (injected) return;
	injected = true;
	const script = document.createElement('script');
	script.dataset.resSlimSabotage = '';
	if (module.options.logBlocked.value) script.dataset.resSlimSabotageLog = '1';
	script.src = getURL(PAGE_SCRIPT);
	// Removing the element before it has run would be pointless here and is not
	// what cleans up: a script with a `src` keeps loading once inserted, so the
	// tidy-up waits for the load rather than racing it.
	script.addEventListener('load', () => script.remove());
	script.addEventListener('error', () => script.remove());
	(document.head || document.documentElement || document.body).prepend(script);
};
