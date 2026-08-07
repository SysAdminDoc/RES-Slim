/* @flow */
// RES-Slim: defuse Reddit's first-party event-tracking pipeline by monkey-patching
// navigator.sendBeacon, fetch, and XMLHttpRequest.open in the page world for a
// curated tracker-host allowlist. Defaults on. Reversible by toggling the module
// off and reloading the page — runtime undo is impossible once the page script
// has executed.

import { Module } from '../core/module';
import { pageScript } from '../utils/eventTrackingSabotage';

export const module: Module<*> = new Module('eventTrackingSabotage');

module.moduleName = 'Event tracking sabotage';
module.category = 'privacyCategory';
module.description = 'Block Reddit\'s first-party event/telemetry beacons. Reload required to undo per-page.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['privacy', 'tracking', 'beacon', 'analytics', 'telemetry', 'event'];

module.options = {
	logBlocked: {
		type: 'boolean',
		value: false,
		title: 'Log blocked beacons to the console',
		description: 'Verbose. Useful for verifying the sabotage is firing.',
	},
};

// Hosts whose POST/beacon traffic is exclusively analytics. Kept as bare
// hostnames (no https:// prefix) so they do not contribute to the privacy
// URL snapshot scan.
const TRACKER_HOSTS = [
	'events.reddit.com',
	'events.redditmedia.com',
	'pixel.redditmedia.com',
	'e.reddit.com',
	'alb.reddit.com',
	'w3-reporting.reddit.com',
];

// URL pathnames on first-party reddit.com that exist solely for analytics.
const TRACKER_PATHS = [
	'/api/event',
	'/api/v1/page_view',
	'/api/v1/clk',
];

let injected = false;

module.contentStart = () => {
	if (injected) return;
	injected = true;
	const script = document.createElement('script');
	script.textContent = pageScript(TRACKER_HOSTS, TRACKER_PATHS, module.options.logBlocked.value);
	(document.head || document.documentElement || document.body).prepend(script);
	script.remove();
};
