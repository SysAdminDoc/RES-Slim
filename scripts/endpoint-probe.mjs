// One request against one third-party endpoint, with the two judgements that a
// bare status code cannot make.
//
// Extracted from `check-endpoints.mjs` so a contract can drive it against a
// stubbed `fetch`. The gate's whole job is to notice a third party moving or
// dying, and until this was testable the gate itself had no test.
//
// **A cross-host redirect is a failure, not a success.** This is the case that
// let the Twitter break ship. `publish.twitter.com/oembed` began answering
// `301 https://publish.x.com/oembed`, and a probe that follows redirects reads
// that as a healthy 200 from the new host. The extension cannot: its request
// carries an optional host permission for the *old* origin, and a cross-origin
// redirect to an origin it has no permission for sends no CORS header it is
// allowed to read, so the fetch is refused outright. So the endpoint was dead
// for the extension and alive for the gate, for as long as anyone cared to look.
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

export const healthy = status => status === 429 || (status >= 200 && status < 400);

const isRedirect = status => status >= 300 && status < 400;

function hostOf(url) {
	try {
		return new URL(url).host;
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
	const { name, expect, accept = [] } = entry;
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
				headers: { 'user-agent': 'RES-Slim endpoint check' },
			});
			const status = response.status;

			if (isRedirect(status)) {
				const location = response.headers.get('location');
				const target = location ? new URL(location, url).toString() : null;
				const from = hostOf(url);
				const to = target && hostOf(target);
				if (!target) return { name, url, status, ok: false, error: 'redirected with no Location header' };
				if (to !== from) {
					return {
						name,
						url,
						status,
						ok: false,
						error: `moved to another host: the permission covers ${from}, the endpoint is now on ${to}`,
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
			if (expect && status !== 429) {
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
