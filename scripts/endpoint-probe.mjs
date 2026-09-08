// One request against one third-party endpoint, with the two judgements that a
// bare status code cannot make.
//
// Extracted from `check-endpoints.mjs` so a contract can drive it against a
// stubbed `fetch`. The gate's whole job is to notice a third party moving or
// dying, and until this was testable the gate itself had no test.
//
// **A redirect to another origin is a failure, not a success.** This is the case
// that let the Twitter break ship. `publish.twitter.com/oembed` began answering
// `301 https://publish.x.com/oembed`, and a probe that follows redirects reads
// that as a healthy 200 from the new host. The extension cannot follow it: a
// host request runs in the background worker at the extension's own origin, and
// the browser refuses the redirect because the extension holds no host
// permission for the target. So the endpoint was dead for the extension and
// alive for the gate, for as long as anyone cared to look.
//
// A redirect *within* the same host is followed, because that is a service
// reorganising its own paths and the extension's permission still covers it.
//
// **Some endpoints answer an unauthenticated probe with a refusal.** Half the
// permission-declaring hosts want an API key the gate has no business holding.
// `401` and `403` from those say the host is up and the path still exists, which
// is exactly what the gate is for; treating them as dead would make the run red
// forever and teach everyone to ignore it. Entries that need this say so with
// `accept`, one host at a time, rather than the predicate being loosened for all.

export const MAX_SAME_HOST_REDIRECTS = 3;

// 3xx is not the same as "redirect". 304 means the cached copy is current, and
// 300 offers choices without picking one; neither carries the extension anywhere,
// and treating them as a redirect with no `Location` reported a live endpoint as
// broken. The four that actually move a request are these.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const healthy = status => status === 429 || (status >= 200 && status < 400);

const isRedirect = status => REDIRECT_STATUSES.has(status);

// Scheme and host, without the port.
//
// Scheme, because a permission of `https://api.example/*` does not cover an
// `http://` target -- the browser would refuse it as mixed content even if the
// permission did, so a downgrade is a move as surely as a rename is. Comparing
// bare hosts missed that, which is the same class of bug this file exists to
// catch. Without the port, because a Chrome match pattern ignores it, so
// `https://a.example:8443` really is covered by a permission for
// `https://a.example/*` and calling that a move would be a false alarm.
function originOf(url) {
	try {
		const parsed = new URL(url);
		return `${parsed.protocol}//${parsed.hostname}`;
	} catch (e) {
		return null;
	}
}

/**
 * @param entry  { name, url, expect?, accept? }
 * @param deps   { fetch, timeoutMs } — injected so a contract can drive this
 *               without a network, and so the timeout is visible to the caller.
 */
export async function probeEndpoint(entry, { fetch: doFetch, timeoutMs = 15000 } = {}) {
	// `method` and `body` because an endpoint that only answers a POST cannot be
	// probed with a GET: the Steam one returns 405 to a GET, and accepting that
	// would assert only that some router is listening. Probing the request the
	// module actually makes is the whole point.
	const { name, expect, accept = [], method = 'GET', body } = entry;
	// A body on a GET is a configuration mistake, and `fetch` throws for it --
	// which the catch below would report as `status: 0`, indistinguishable from a
	// dead host. Say what it is instead.
	if (body && method === 'GET') {
		return { name, url: entry.url, status: 0, ok: false, error: 'a GET cannot carry a body; set method: POST on this entry' };
	}
	const accepted = new Set(accept);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let url = entry.url;
	try {
		let hops = 0;
		while (hops <= MAX_SAME_HOST_REDIRECTS) {
			// eslint-disable-next-line no-await-in-loop
			const response = await doFetch(url, {
				signal: controller.signal,
				redirect: 'manual',
				method,
				headers: {
					'user-agent': 'RES-Slim endpoint check',
					...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
				},
				...(body ? { body } : {}),
			});
			const status = response.status;

			// An explicitly accepted status is an answer rather than a hop, so it
			// skips the redirect branch: otherwise `accept: [302]` would be
			// silently unreachable, a knob that reads as available and is not. It
			// does not skip the body check below, because pairing an accepted
			// status with the service's own payload is the whole reason `accept`
			// is safe to have.
			if (isRedirect(status) && !accepted.has(status)) {
				const location = response.headers.get('location');
				const target = location ? new URL(location, url).toString() : null;
				const from = originOf(url);
				const to = target && originOf(target);
				if (!target) return { name, url, status, ok: false, error: 'redirected with no Location header' };
				if (to !== from) {
					return {
						name,
						url,
						status,
						ok: false,
						error: `moved: the permission covers ${from}, the endpoint is now on ${to}`,
					};
				}
				url = target;
				hops += 1;
				continue;
			}

			if (!healthy(status) && !accepted.has(status)) return { name, url, status, ok: false };
			// Only read the body where there is something to assert; a 429 has no
			// meaningful body and reading it would just slow the run down.
			//
			// An accepted status is checked too, and that is the point of pairing the
			// two: `404` on its own is what a parked domain, a stray proxy and a
			// working API asked for a missing id all return. The service's own error
			// payload is the only thing that tells them apart.
			// 304 has no body by definition, so there is nothing for an `expect` to
			// match and requiring one would report a live endpoint as a bot
			// challenge. 429 likewise carries nothing worth reading.
			if (expect && status !== 429 && status !== 304) {
				// eslint-disable-next-line no-await-in-loop
				const body = await response.text();
				if (!expect.test(body)) {
					return { name, url, status, ok: false, error: 'responded, but the body is not the expected service (bot challenge?)' };
				}
			}
			return { name, url, status, ok: true };
		}
		return { name, url, status: 0, ok: false, error: `more than ${MAX_SAME_HOST_REDIRECTS} redirects within the same host` };
	} catch (e) {
		return { name, url, status: 0, ok: false, error: e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message };
	} finally {
		clearTimeout(timer);
	}
}
