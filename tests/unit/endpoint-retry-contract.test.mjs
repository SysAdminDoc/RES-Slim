import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MAX_TRANSPORT_ATTEMPTS, withTransportRetries } from '../../scripts/endpoint-retry.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('transport failures retry up to three attempts and can recover', async () => {
	let calls = 0;
	const waits = [];
	const result = await withTransportRetries(() => {
		calls += 1;
		return calls < 3 ? { ok: false, status: 0, error: 'timeout' } : { ok: true, status: 200 };
	}, { wait: attempt => { waits.push(attempt); } });

	assert.equal(MAX_TRANSPORT_ATTEMPTS, 3);
	assert.equal(calls, 3);
	assert.deepEqual(waits, [1, 2]);
	assert.deepEqual(result, { ok: true, status: 200, attempts: 3 });
});

// This file used to say the opposite: that any HTTP response fails immediately
// rather than being hidden by retries, with 503 as its example. That was the
// right instinct about the wrong status. A 4xx is an answer from a working
// server and still fails on the first one; a gateway status says the request did
// not reach a server at all, which is what the transport retry is already for.
//
// The change is not tidiness. web.archive.org's CDX API flaps between 200 and
// 503 from this machine within seconds - measured three times on 2026-09-02,
// from the gate's own fetch and from a second client - and one 503 failed the
// whole push, so three pushes in a row went out with `--no-verify`, skipping
// every other gate. A gate that is routinely bypassed checks nothing.
test('a client error fails immediately instead of being hidden by retries', async () => {
	for (const status of [400, 401, 403, 404, 410, 418]) {
		let calls = 0;
		const result = await withTransportRetries(() => { // eslint-disable-line no-await-in-loop
			calls += 1;
			return { ok: false, status };
		}, { wait: () => { throw new Error('a client error must not wait'); } });

		assert.equal(calls, 1, `${status} should be believed the first time`);
		assert.deepEqual(result, { ok: false, status, attempts: 1 });
	}
});

test('a gateway status is retried, and still fails when it persists', async () => {
	for (const status of [502, 503, 504]) {
		let calls = 0;
		const flapping = await withTransportRetries(() => { // eslint-disable-line no-await-in-loop
			calls += 1;
			return calls < 2 ? { ok: false, status } : { ok: true, status: 200 };
		}, { wait: () => undefined });
		assert.deepEqual(flapping, { ok: true, status: 200, attempts: 2 }, `a host that answers 200 after one ${status} is not dead`);

		let persistent = 0;
		const gone = await withTransportRetries(() => { // eslint-disable-line no-await-in-loop
			persistent += 1;
			return { ok: false, status };
		}, { wait: () => undefined });
		assert.equal(persistent, MAX_TRANSPORT_ATTEMPTS, `a persistent ${status} should use every attempt`);
		assert.deepEqual(gone, { ok: false, status, attempts: MAX_TRANSPORT_ATTEMPTS }, 'and then fail');
	}
});

test('a persistent transport failure stops at the bound', async () => {
	let calls = 0;
	const result = await withTransportRetries(() => {
		calls += 1;
		return { ok: false, status: 0, error: 'offline' };
	}, { wait: () => undefined });

	assert.equal(calls, 3);
	assert.deepEqual(result, { ok: false, status: 0, error: 'offline', attempts: 3 });
});

test('the live endpoint gate routes every individual probe through the retry helper', () => {
	const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'check-endpoints.mjs'), 'utf8');
	assert.match(source, /withTransportRetries\(\(\) => probeAttempt\(entry\)\)/);
});
