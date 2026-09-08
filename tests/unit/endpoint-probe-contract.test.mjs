// The gate that is supposed to notice a third party moving, tested.
//
// It did not notice the Twitter one. `publish.twitter.com/oembed` began
// answering `301 https://publish.x.com/oembed`, and the probe followed the
// redirect and read a healthy 200 from the new host. The extension cannot follow
// it: its request carries an optional host permission for the old origin, and a
// cross-origin redirect to an origin it has no permission for sends no CORS
// header it may read, so the fetch is refused. The endpoint was dead for the
// extension and alive for the gate.
//
// The second half is coverage. The gate probed one oEmbed endpoint out of the
// sixteen hosts that declare an optional permission, so fifteen third parties
// could have died with nothing to say so.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { probeEndpoint, healthy, MAX_SAME_HOST_REDIRECTS } from '../../scripts/endpoint-probe.mjs';
import { FETCHED, LINKED } from '../../scripts/endpoint-list.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// A `fetch` that answers from a script rather than a network, and records how it
// was called.
//
// The first version of this recorded only the URL, which made the whole file
// unfalsifiable: deleting `redirect: 'manual'` from the probe -- the single line
// the work exists for -- left all seven tests green, because no assertion could
// see what the probe asked fetch to do. A stub that drops the argument under
// test is a stub that tests nothing.
//
// It also refuses to follow a redirect itself, the way a real `redirect: 'manual'`
// fetch does not, so a probe that stopped passing that option would run off the
// end of the script and fail loudly rather than quietly reading the last step.
function stubFetch(steps) {
	const calls = [];
	const remaining = [...steps];
	const doFetch = (url, options = {}) => {
		calls.push({ url, options });
		const step = remaining.shift();
		if (!step) throw new Error(`unexpected request to ${url}`);
		return Promise.resolve({
			status: step.status,
			headers: { get: name => (name.toLowerCase() === 'location' ? step.location || null : null) },
			text: () => Promise.resolve(step.body || ''),
		});
	};
	return { doFetch, calls, urls: () => calls.map(call => call.url) };
}

test('the probe asks for manual redirects, or it can never see one', () => {
	// Everything else in this file rests on the probe being handed the redirect
	// itself. With `redirect: 'follow'` the browser resolves a 301 transparently
	// and the probe is handed the final 200, so the cross-host check below has
	// nothing to check.
	const { doFetch, calls } = stubFetch([{ status: 200, body: '{}' }]);
	return probeEndpoint({ name: 'x', url: 'https://example.test/a' }, { fetch: doFetch }).then(() => {
		assert.equal(calls.length, 1);
		assert.equal(calls[0].options.redirect, 'manual', 'a followed redirect is one the probe never sees');
		assert.ok(calls[0].options.signal, 'and the timeout has to reach the request');
	});
});

test('a probe that needs a POST sends one', () => {
	// The Steam endpoint answers 405 to a GET. Probing it with the wrong method
	// and then accepting 405 asserts only that a router is listening.
	const { doFetch, calls } = stubFetch([{ status: 200, body: '{"publishedfiledetails":[]}' }]);
	return probeEndpoint(
		{ name: 'steam', url: 'https://api.test/x', method: 'POST', body: 'itemcount=1' },
		{ fetch: doFetch },
	).then(result => {
		assert.equal(result.ok, true);
		assert.equal(calls[0].options.method, 'POST');
		assert.equal(calls[0].options.body, 'itemcount=1');
	});
});

test('a redirect to another host fails, and says which host it moved to', async () => {
	const { doFetch, urls } = stubFetch([
		{ status: 301, location: 'https://publish.x.com/oembed' },
	]);

	const result = await probeEndpoint(
		{ name: 'Twitter/X oEmbed', url: 'https://publish.twitter.com/oembed' },
		{ fetch: doFetch },
	);

	assert.equal(result.ok, false, 'a cross-host redirect is not a healthy endpoint');
	assert.match(result.error, /publish\.twitter\.com/, 'the message has to name the host the permission covers');
	assert.match(result.error, /publish\.x\.com/, 'and the host it moved to');
	assert.equal(urls().length, 1, 'the redirect must not be followed');
});

test('a redirect within the same host is followed', async () => {
	// A service reorganising its own paths. The extension's permission still
	// covers it, so this is not a break.
	const { doFetch, urls } = stubFetch([
		{ status: 302, location: '/v2/oembed' },
		{ status: 200, body: '{}' },
	]);

	const result = await probeEndpoint(
		{ name: 'same host', url: 'https://example.test/oembed' },
		{ fetch: doFetch },
	);

	assert.equal(result.ok, true);
	assert.deepEqual(urls(), ['https://example.test/oembed', 'https://example.test/v2/oembed']);
});

test('a scheme downgrade is a move, and a port change is not', async () => {
	// A permission for `https://api.example/*` does not cover an `http://` target,
	// and the browser would refuse it as mixed content even if it did. Comparing
	// bare hosts called that healthy -- the same class of miss this file exists
	// for. A port, by contrast, is ignored by a Chrome match pattern, so changing
	// one is not a move and calling it one would be a false alarm.
	const downgraded = await probeEndpoint(
		{ name: 'downgrade', url: 'https://api.test/x' },
		{ fetch: stubFetch([{ status: 301, location: 'http://api.test/x' }]).doFetch },
	);
	assert.equal(downgraded.ok, false, 'https to http is a move');
	assert.match(downgraded.error, /https:\/\/api\.test/);

	const reported = await probeEndpoint(
		{ name: 'port', url: 'https://api.test/x' },
		{ fetch: stubFetch([{ status: 301, location: 'https://api.test:8443/x' }, { status: 200, body: '{}' }]).doFetch },
	);
	assert.equal(reported.ok, true, 'a port is not part of what a permission covers');
});

test('a 3xx that is not a redirect is not read as one', async () => {
	// 304 says the cached copy is current and 300 offers choices without picking
	// one. Neither carries the request anywhere, and treating them as a redirect
	// with no `Location` reported a live endpoint as broken.
	for (const status of [300, 304]) {
		// eslint-disable-next-line no-await-in-loop
		const result = await probeEndpoint(
			{ name: 'not a redirect', url: 'https://api.test/x' },
			{ fetch: stubFetch([{ status }]).doFetch },
		);
		assert.equal(result.ok, true, `${status} is not a redirect and the endpoint answered`);
	}
});

test('a redirect loop within one host stops rather than spinning', async () => {
	const steps = Array.from({ length: MAX_SAME_HOST_REDIRECTS + 2 }, () => ({ status: 302, location: '/again' }));
	const { doFetch } = stubFetch(steps);
	const result = await probeEndpoint({ name: 'loop', url: 'https://example.test/a' }, { fetch: doFetch });
	assert.equal(result.ok, false);
	assert.match(result.error, /more than \d+ redirects/);
});

test('a refusal an unauthenticated probe cannot avoid still has to look like the service', async () => {
	// Half these hosts want an API key the gate has no business holding, so a 401
	// or a 404 from them means the host is up and the path resolves. On its own
	// that status is also what a parked domain returns, which is why an accepted
	// status is paired with the service's own error payload.
	const alive = await probeEndpoint(
		{ name: 'keyed API', url: 'https://api.test/x', accept: [404], expect: /itemNotFound/ },
		{ fetch: stubFetch([{ status: 404, body: '{"error":{"code":"itemNotFound"}}' }]).doFetch },
	);
	assert.equal(alive.ok, true);

	const parked = await probeEndpoint(
		{ name: 'keyed API', url: 'https://api.test/x', accept: [404], expect: /itemNotFound/ },
		{ fetch: stubFetch([{ status: 404, body: '<html>domain for sale</html>' }]).doFetch },
	);
	assert.equal(parked.ok, false, 'a parked domain answers 404 too');

	// And an accepted status is not a blanket pass: a status nobody listed still
	// fails.
	const refused = await probeEndpoint(
		{ name: 'keyed API', url: 'https://api.test/x', accept: [404] },
		{ fetch: stubFetch([{ status: 500 }]).doFetch },
	);
	assert.equal(refused.ok, false);
});

test('rate limiting is not death, and a 4xx nobody accepted is', () => {
	assert.equal(healthy(429), true, 'a rate-limited host is up');
	assert.equal(healthy(200), true);
	assert.equal(healthy(399), true);
	assert.equal(healthy(404), false);
	assert.equal(healthy(500), false);
});

test('every host that declares an optional permission is probed, or is deliberately not', () => {
	// A permission is a promise that a module will reach exactly that origin. An
	// origin that has moved or died is a broken module, and this gate is the only
	// thing that would notice.
	//
	// The entries are imported, not regexed out of the runner. The first version
	// of this searched the script's text for `(hosts/<name>)`, which a comment
	// satisfies: replacing an entry with `// TODO: restore the (hosts/tumblr)
	// probe` left both coverage tests green with tumblr entirely unprobed. It was
	// evadable by a reformat too -- two spaces, a double-quoted name, a
	// multi-line entry or a camelCase directory all slipped past the pattern.
	const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
	const declaring = fs.readdirSync(hostsDir)
		.filter(file => file.endsWith('.js'))
		.filter(file => /^\s*permissions: \[/m.test(fs.readFileSync(path.join(hostsDir, file), 'utf8')))
		.map(file => file.replace(/\.js$/, ''));

	assert.equal(declaring.length, 16, `expected 16 permission-declaring hosts, found ${declaring.length}; update this number deliberately`);

	// `FETCHED` only. `LINKED` is reported and does not gate the build, so moving
	// an entry there is a way to stop a host failing without fixing it -- and the
	// first version of this read both lists, which could not tell the two apart.
	const hostsIn = list => new Set(list
		.flatMap(entry => (entry.anyOf ? entry.anyOf : [entry]))
		.map(entry => /\(hosts\/([A-Za-z]+)\)/.exec(entry.name))
		.filter(Boolean)
		.map(match => match[1]));
	const gated = hostsIn(FETCHED);
	const linkedOnly = hostsIn(LINKED);

	// Two hosts are exempt, each for a stated reason, and the set is closed:
	// growing it is a change to this list, not something that can happen by
	// adding a name.
	//
	//   vreddit  its permission is reddit's own media infrastructure, and probing
	//            it would make this gate fetch reddit from the machine that runs
	//            it, which the house rules forbid.
	//   threads  the module frames the page rather than fetching it, so a scripted
	//            refusal says nothing about whether the reader's frame loads. It
	//            is probed, in `LINKED`.
	const EXEMPT = new Set(['vreddit', 'threads']);
	assert.equal(EXEMPT.size, 2, 'the exemption list is closed; adding to it is a decision, not an omission');

	const missing = declaring.filter(host => !gated.has(host) && !EXEMPT.has(host));
	assert.deepEqual(missing, [], `these hosts declare a permission and nothing gates them: ${missing.join(', ')}`);

	// An exemption must still be a permission-declaring host, and one exempted for
	// being framed must actually still be probed somewhere.
	const stale = [...EXEMPT].filter(host => !declaring.includes(host));
	assert.deepEqual(stale, [], `exempt from the gate but no longer a permission-declaring host: ${stale.join(', ')}`);
	assert.ok(linkedOnly.has('threads'), 'threads is exempt from the gate because it is probed as a link, not because it is unprobed');
});

// A Chrome match pattern, modelled the way Chromium implements it.
//
// The first version of this compared scheme and host and dropped the path, on
// the grounds that Chromium builds its CORS allowlist from origins. That is true
// of *CORS*, and it is not how a host permission is matched: `URLPattern::
// MatchesURL` calls `MatchesPath(test.PathForRequest())`, and `PathForRequest()`
// is the path **plus the query string**. So `https://www.flickr.com/services/
// oembed` matches a request to that path with no query and nothing else -- while
// every oEmbed call in this codebase appends `?url=…`.
//
// Six permissions were wrong that way, and three of the hosts (flickr,
// deviantart, gyazo) send no `Access-Control-Allow-Origin` at all, measured
// 2026-09-08, so the permission was the only thing that could have let the
// request through. Dropping the path is what made that invisible.
function matchesPattern(pattern, url) {
	const parsed = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
	if (!parsed) return false;
	const [, scheme, host, path] = parsed;

	const target = new URL(url);
	if (scheme !== '*' && `${scheme}:` !== target.protocol) return false;
	if (scheme === '*' && !['http:', 'https:'].includes(target.protocol)) return false;

	if (host !== '*') {
		if (host.startsWith('*.')) {
			const bare = host.slice(2);
			if (target.hostname !== bare && !target.hostname.endsWith(`.${bare}`)) return false;
		} else if (host !== target.hostname) {
			return false;
		}
	}

	// The path is glob-matched against path + query, which is what
	// `GURL::PathForRequest()` returns.
	const pathForRequest = `${target.pathname}${target.search}`;
	const escaped = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp(`^${escaped}$`).test(pathForRequest);
}

test('the match-pattern model agrees with how Chromium matches one', () => {
	// The property the six broken permissions violated, stated first.
	assert.equal(matchesPattern('https://a.test/oembed', 'https://a.test/oembed'), true);
	assert.equal(matchesPattern('https://a.test/oembed', 'https://a.test/oembed?url=x'), false,
		'the query is part of what a pattern path is matched against');
	assert.equal(matchesPattern('https://a.test/oembed*', 'https://a.test/oembed?url=x'), true);

	// Host wildcards, and the boundary that stops `*.redd.it` covering
	// `notredd.it`.
	assert.equal(matchesPattern('https://*.redd.it/*', 'https://v.redd.it/x'), true);
	assert.equal(matchesPattern('https://*.redd.it/*', 'https://redd.it/x'), true);
	assert.equal(matchesPattern('https://*.redd.it/*', 'https://notredd.it/x'), false);

	// Scheme, which a downgrade escapes.
	assert.equal(matchesPattern('https://a.test/*', 'http://a.test/x'), false);
	assert.equal(matchesPattern('*://a.test/*', 'http://a.test/x'), true);

	// A path wildcard in the middle, which is how the tumblr permission is built.
	assert.equal(matchesPattern('https://api.test/v2/blog/*/posts*', 'https://api.test/v2/blog/staff/posts?id=1'), true);
	assert.equal(matchesPattern('https://api.test/v2/blog/*/posts*', 'https://api.test/v2/other/staff/posts'), false);
});

test('every host probe URL is covered by that host module own permission', () => {
	// The check the previous version could not make. A probe URL is the shape the
	// module actually requests, so a permission that does not match it is a
	// permission that cannot let the request through -- and for the three hosts
	// that send no CORS header of their own, that is the whole request.
	const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
	const declared = new Map();
	for (const file of fs.readdirSync(hostsDir).filter(name => name.endsWith('.js'))) {
		const source = fs.readFileSync(path.join(hostsDir, file), 'utf8');
		const block = /^\s*permissions: \[([^\]]*)\]/m.exec(source);
		if (!block) continue;
		declared.set(file.replace(/\.js$/, ''), [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
	}
	assert.equal(declared.size, 16, `expected 16 permission-declaring hosts, found ${declared.size}`);

	const uncovered = FETCHED
		.flatMap(entry => (entry.anyOf ? entry.anyOf : [entry]))
		.map(entry => ({ url: entry.url, host: (/\(hosts\/([A-Za-z]+)\)/.exec(entry.name) || [])[1] }))
		.filter(entry => entry.host && declared.has(entry.host))
		.filter(({ host, url }) => !declared.get(host).some(pattern => matchesPattern(pattern, url)))
		.map(({ host, url }) => `${host}: ${url} is not matched by ${JSON.stringify(declared.get(host))}`);

	assert.deepEqual(uncovered, [], `a host requests a URL its own permission does not cover:\n  ${uncovered.join('\n  ')}`);
});

test('every host permission is one the manifest declares', () => {
	// A module can only ask for what the manifest offers. A permission declared in
	// code and missing from the manifest can never be granted, so the expando
	// fails on a prompt the reader answered yes to.
	const manifest = JSON.parse(read('chrome/manifest.json'));
	const offered = new Set([
		...(manifest.host_permissions || []),
		...(manifest.optional_host_permissions || []),
	]);

	const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
	const missing = [];
	for (const file of fs.readdirSync(hostsDir).filter(name => name.endsWith('.js'))) {
		const source = fs.readFileSync(path.join(hostsDir, file), 'utf8');
		const block = /^\s*permissions: \[([^\]]*)\]/m.exec(source);
		if (!block) continue;
		for (const [, pattern] of block[1].matchAll(/'([^']+)'/g)) {
			if (!offered.has(pattern)) missing.push(`${file}: ${pattern}`);
		}
	}
	assert.deepEqual(missing, [], `declared in code, absent from the manifest:\n  ${missing.join('\n  ')}`);
});
