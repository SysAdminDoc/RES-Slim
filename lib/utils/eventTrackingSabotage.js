/* @flow */

// The page-world half of eventTrackingSabotage.
//
// This is real code that runs in the page, not a template literal that gets
// injected as a script's `textContent`. It was the latter for its whole life,
// and Chrome refuses that: an inline script a content script writes is checked
// against the *extension's* CSP, which is `script-src 'self'`. So the module sat
// default-on, described in settings as blocking Reddit's telemetry beacons, and
// never once executed. It ships as a web-accessible file now, injected by `src`,
// which neither CSP objects to.
//
// It lives apart from the module so a test can call it against a stub scope.
// That matters: the fetch branch shipped broken for its entire life because
// `new Response('', { status: 204 })` throws — 204 is a null-body status, so the
// constructor rejects any body, including the empty string — and the surrounding
// `catch (_) {}` swallowed the throw and fell through to the real fetch. Every
// source-level assertion about this module passed the whole time.
//
// The tracker lists live here rather than in the module because the module no
// longer needs them: it injects a file instead of building that file's text. The
// alternative, handing them over on a data attribute, would have let a page
// script empty the list before this ran.

// Hosts whose POST/beacon traffic is exclusively analytics. Kept as bare
// hostnames (no https:// prefix) so they do not contribute to the privacy
// URL snapshot scan.
export const TRACKER_HOSTS = [
	'events.reddit.com',
	'events.redditmedia.com',
	'pixel.redditmedia.com',
	'e.reddit.com',
	'alb.reddit.com',
	'w3-reporting.reddit.com',
];

// URL pathnames on first-party reddit.com that exist solely for analytics.
//
// `rules/ad-block.json` rule 2 blocks these three at the network layer already,
// but only for the `xmlhttprequest` and `ping` resource types, and only once the
// request has been built and handed to the network stack. Patching the callers
// means the payload is never serialised at all, and covers whatever transport
// Reddit reaches for next. The two are deliberately redundant.
export const TRACKER_PATHS = [
	'/api/event',
	'/api/v1/page_view',
	'/api/v1/clk',
];

// Everything the patched functions touch is read off `scope` rather than off the
// module's own globals, so a test can hand in a fake page and watch what reaches
// the originals. In the browser `scope` is `window`; the type names only the
// members this touches, so a stub page is a legal argument and a typo in one of
// them is not.
type PageScope = {
	console: { warn: (...args: Array<mixed>) => mixed },
	location: { +href: string },
	navigator: { sendBeacon?: (url: mixed, data?: mixed) => boolean },
	setTimeout: (fn: () => mixed, ms: number) => mixed,
	fetch?: (input: mixed, init?: mixed) => Promise<mixed>,
	URL: Class<URL>,
	Response: Class<Response>,
	Event: Class<Event>,
	XMLHttpRequest: { prototype: { open: (...args: Array<mixed>) => mixed, send: (...args: Array<mixed>) => mixed } },
};

export function installSabotage(scope: PageScope, hosts: string[], paths: string[], logBlocked: boolean): void {
	const { console: pageConsole, location: pageLocation, navigator: pageNavigator, setTimeout: pageSetTimeout } = scope;
	const { URL: PageURL, Response: PageResponse, Event: PageEvent, XMLHttpRequest: PageXHR } = scope;

	const log = (...args) => {
		if (!logBlocked) return;
		try { pageConsole.warn('[RES-Slim] blocked beacon', ...args); } catch (e) { /* the page replaced console */ }
	};
	// A blocker that fails silently is worse than no blocker: the traffic goes
	// out and nothing says so. Every swallow point below reports.
	const failed = (where, err) => {
		try { pageConsole.warn(`[RES-Slim] tracking sabotage failed in ${where}, request allowed through:`, err); } catch (e) { /* as above */ }
	};

	const matches = url => {
		if (typeof url !== 'string' && !(url instanceof PageURL) && !(url && url.url)) return false;
		let str;
		// Stringified either way: a Request-like object can carry any type on
		// `url`, and handing a non-string to the URL constructor is how a
		// classifier starts throwing on traffic it should have judged.
		try { str = (url && url.url) ? String(url.url) : String(url); } catch (e) { return false; }
		try {
			const u = new PageURL(str, pageLocation.href);
			if (hosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) return true;
			if (u.hostname.endsWith('reddit.com') && paths.some(p => u.pathname === p || u.pathname.startsWith(`${p}/`))) return true;
		} catch (e) { return false; }
		return false;
	};

	const origBeacon = pageNavigator.sendBeacon && pageNavigator.sendBeacon.bind(pageNavigator);
	if (origBeacon) {
		pageNavigator.sendBeacon = function(url, data) {
			if (matches(url)) { log('sendBeacon', url); return true; }
			return origBeacon(url, data);
		};
	}

	const origFetch = scope.fetch && scope.fetch.bind(scope);
	if (origFetch) {
		scope.fetch = function(input, init) {
			let blocked;
			try {
				const url = (input && input.url) ? input.url : input;
				blocked = matches(url);
				if (blocked) log('fetch', url);
			} catch (e) {
				failed('fetch match', e);
				return origFetch(input, init);
			}
			if (!blocked) return origFetch(input, init);
			// 204 is a null-body status. Passing '' here throws, and the throw is
			// what used to let the beacon through.
			try {
				return Promise.resolve(new PageResponse(null, { status: 204, statusText: 'No Content' }));
			} catch (e) {
				// Still must not forward the beacon — a blocked request that cannot
				// be faked should fail, not succeed.
				failed('fetch response', e);
				return Promise.reject(new TypeError('Failed to fetch'));
			}
		};
	}

	const origOpen = PageXHR.prototype.open;
	PageXHR.prototype.open = function(method, url, ...rest) {
		this.__resSlimBlockedTarget = matches(url) ? url : null;
		return Reflect.apply(origOpen, this, [method, url, ...rest]);
	};
	const origSend = PageXHR.prototype.send;
	PageXHR.prototype.send = function(body) {
		if (this.__resSlimBlockedTarget) {
			log('xhr', this.__resSlimBlockedTarget);
			// Fire fake load to keep callers happy without leaking telemetry.
			pageSetTimeout(() => {
				Reflect.defineProperty(this, 'readyState', { value: 4, configurable: true });
				Reflect.defineProperty(this, 'status', { value: 204, configurable: true });
				try { this.dispatchEvent(new PageEvent('load')); } catch (e) { /* stub XHR without events */ }
				try { this.dispatchEvent(new PageEvent('loadend')); } catch (e) { /* as above */ }
			}, 0);
			return;
		}
		return Reflect.apply(origSend, this, [body]);
	};
}
