/* @flow */
// RES-Slim: defuse Reddit's first-party event-tracking pipeline by monkey-patching
// navigator.sendBeacon, fetch, and XMLHttpRequest.open in the page world for a
// curated tracker-host allowlist. Defaults on. Reversible by toggling the module
// off and reloading the page — runtime undo is impossible once the page script
// has executed.

import { Module } from '../core/module';

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

function pageScript(trackerHosts: string[], trackerPaths: string[], logBlocked: boolean): string {
	return `(() => {
	const HOSTS = ${JSON.stringify(trackerHosts)};
	const PATHS = ${JSON.stringify(trackerPaths)};
	const LOG = ${JSON.stringify(logBlocked)};
	const log = (...args) => { if (LOG) try { console.warn('[RES-Slim] blocked beacon', ...args); } catch (_) {} };
	const matches = (url) => {
		if (typeof url !== 'string' && !(url instanceof URL) && !(url && url.url)) return false;
		let str;
		try { str = (url && url.url) ? url.url : String(url); } catch (_) { return false; }
		try {
			const u = new URL(str, location.href);
			if (HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return true;
			if (u.hostname.endsWith('reddit.com') && PATHS.some(p => u.pathname === p || u.pathname.startsWith(p + '/'))) return true;
		} catch (_) { return false; }
		return false;
	};

	const origBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
	if (origBeacon) {
		navigator.sendBeacon = function(url, data) {
			if (matches(url)) { log('sendBeacon', url); return true; }
			return origBeacon(url, data);
		};
	}

	const origFetch = window.fetch && window.fetch.bind(window);
	if (origFetch) {
		window.fetch = function(input, init) {
			try {
				const url = (input && input.url) ? input.url : input;
				if (matches(url)) { log('fetch', url); return Promise.resolve(new Response('', { status: 204 })); }
			} catch (_) {}
			return origFetch(input, init);
		};
	}

	const origOpen = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function(method, url, ...rest) {
		this.__resSlimBlockedTarget = matches(url) ? url : null;
		return origOpen.call(this, method, url, ...rest);
	};
	const origSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.send = function(body) {
		if (this.__resSlimBlockedTarget) {
			log('xhr', this.__resSlimBlockedTarget);
			// Fire fake load to keep callers happy without leaking telemetry.
			setTimeout(() => {
				Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
				Object.defineProperty(this, 'status', { value: 204, configurable: true });
				try { this.dispatchEvent(new Event('load')); } catch (_) {}
				try { this.dispatchEvent(new Event('loadend')); } catch (_) {}
			}, 0);
			return;
		}
		return origSend.call(this, body);
	};
})();`;
}

let injected = false;

module.contentStart = () => {
	if (injected) return;
	injected = true;
	const script = document.createElement('script');
	script.textContent = pageScript(TRACKER_HOSTS, TRACKER_PATHS, module.options.logBlocked.value);
	(document.head || document.documentElement || document.body).prepend(script);
	script.remove();
};
