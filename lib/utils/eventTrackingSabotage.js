/* @flow */

// The page-world script eventTrackingSabotage injects.
//
// Lives here rather than in the module so a test can build it and *run* it
// against stub globals. That matters: the fetch branch shipped broken for its
// entire life because `new Response('', { status: 204 })` throws — 204 is a
// null-body status, so the constructor rejects any body, including the empty
// string — and the surrounding `catch (_) {}` swallowed the throw and fell
// through to the real fetch. Every source-level assertion about this module
// passed the whole time. The contract now executes the wrapper and asserts the
// tracker URL never reaches the original.

export function pageScript(trackerHosts: string[], trackerPaths: string[], logBlocked: boolean): string {
	return `(() => {
	const HOSTS = ${JSON.stringify(trackerHosts)};
	const PATHS = ${JSON.stringify(trackerPaths)};
	const LOG = ${JSON.stringify(logBlocked)};
	const log = (...args) => { if (LOG) try { console.warn('[RES-Slim] blocked beacon', ...args); } catch (_) {} };
	// A blocker that fails silently is worse than no blocker: the traffic goes
	// out and nothing says so. Every swallow point below reports.
	const failed = (where, err) => { try { console.warn('[RES-Slim] tracking sabotage failed in ' + where + ', request allowed through:', err); } catch (_) {} };
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
			let blocked = false;
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
				return Promise.resolve(new Response(null, { status: 204, statusText: 'No Content' }));
			} catch (e) {
				// Still must not forward the beacon — a blocked request that cannot
				// be faked should fail, not succeed.
				failed('fetch response', e);
				return Promise.reject(new TypeError('Failed to fetch'));
			}
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
