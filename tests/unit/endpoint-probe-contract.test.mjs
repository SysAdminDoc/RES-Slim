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

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// A `fetch` that answers from a script rather than a network.
function stubFetch(steps) {
	const seen = [];
	const remaining = [...steps];
	const doFetch = url => {
		seen.push(url);
		const step = remaining.shift();
		if (!step) throw new Error(`unexpected request to ${url}`);
		return Promise.resolve({
			status: step.status,
			headers: { get: name => (name.toLowerCase() === 'location' ? step.location || null : null) },
			text: () => Promise.resolve(step.body || ''),
		});
	};
	return { doFetch, seen };
}

test('a redirect to another host fails, and says which host it moved to', async () => {
	const { doFetch, seen } = stubFetch([
		{ status: 301, location: 'https://publish.x.com/oembed' },
	]);

	const result = await probeEndpoint(
		{ name: 'Twitter/X oEmbed', url: 'https://publish.twitter.com/oembed' },
		{ fetch: doFetch },
	);

	assert.equal(result.ok, false, 'a cross-host redirect is not a healthy endpoint');
	assert.match(result.error, /publish\.twitter\.com/, 'the message has to name the host the permission covers');
	assert.match(result.error, /publish\.x\.com/, 'and the host it moved to');
	assert.equal(seen.length, 1, 'the redirect must not be followed');
});

test('a redirect within the same host is followed', async () => {
	// A service reorganising its own paths. The extension's permission still
	// covers it, so this is not a break.
	const { doFetch, seen } = stubFetch([
		{ status: 302, location: '/v2/oembed' },
		{ status: 200, body: '{}' },
	]);

	const result = await probeEndpoint(
		{ name: 'same host', url: 'https://example.test/oembed' },
		{ fetch: doFetch },
	);

	assert.equal(result.ok, true);
	assert.deepEqual(seen, ['https://example.test/oembed', 'https://example.test/v2/oembed']);
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

test('every host that declares an optional permission is probed', () => {
	// A permission is a promise that a module will reach exactly that origin. An
	// origin that has moved or died is a broken module, and this gate is the only
	// thing that would notice.
	const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
	const declaring = fs.readdirSync(hostsDir)
		.filter(file => file.endsWith('.js'))
		.map(file => ({ host: file.replace(/\.js$/, ''), source: fs.readFileSync(path.join(hostsDir, file), 'utf8') }))
		.filter(({ source }) => /^\s*permissions: \[/m.test(source))
		.map(({ host }) => host);

	assert.ok(declaring.length >= 15, `only ${declaring.length} hosts declare a permission; the scan has drifted`);

	const gate = read('scripts/check-endpoints.mjs');
	const missing = declaring.filter(host => !gate.includes(`(hosts/${host})`));
	assert.deepEqual(missing, [], `these hosts declare a permission and are never probed: ${missing.join(', ')}`);
});

test('every probed origin is one the extension is actually allowed to reach', () => {
	// The other direction, and the one that would have caught the Twitter break
	// on its own: a probe of an origin no manifest declares is measuring a host
	// the extension could not request even if it were up.
	const gate = read('scripts/check-endpoints.mjs');
	const manifest = JSON.parse(read('chrome/manifest.json'));
	const granted = [
		...(manifest.host_permissions || []),
		...(manifest.optional_host_permissions || []),
	];

	const covers = origin => granted.some(pattern => {
		const [scheme, rest] = pattern.split('://');
		if (!rest) return false;
		const host = rest.split('/')[0];
		if (scheme !== '*' && !origin.startsWith(`${scheme}://`)) return false;
		const originHost = new URL(origin).host;
		if (host.startsWith('*.')) return originHost === host.slice(2) || originHost.endsWith(`.${host.slice(2)}`);
		return host === '*' || host === originHost;
	});

	// Only the entries whose host module declares a permission. The others are
	// media URLs an `<img>` or `<video>` loads, and pages the extension links to
	// or frames -- neither needs a permission and neither would be covered by one.
	const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
	const declaring = new Set(fs.readdirSync(hostsDir)
		.filter(file => file.endsWith('.js'))
		.filter(file => /^\s*permissions: \[/m.test(fs.readFileSync(path.join(hostsDir, file), 'utf8')))
		.map(file => file.replace(/\.js$/, '')));

	const probed = [...gate.matchAll(/\{ name: '[^']*\(hosts\/([a-z]+)\)', url: '([^']+)'/g)]
		.map(match => ({ host: match[1], url: match[2] }))
		.filter(({ host }) => declaring.has(host));
	assert.ok(probed.length >= 15, `only ${probed.length} host probes were parsed; the scan has drifted`);

	const uncovered = probed
		.filter(({ url }) => !covers(url))
		.map(({ host, url }) => `${host}: ${new URL(url).origin}`);
	assert.deepEqual(uncovered, [], `probed origins no manifest permission covers:\n  ${uncovered.join('\n  ')}`);
});
