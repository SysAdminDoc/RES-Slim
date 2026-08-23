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

test('an HTTP response fails immediately instead of being hidden by retries', async () => {
	let calls = 0;
	const result = await withTransportRetries(() => {
		calls += 1;
		return { ok: false, status: 503 };
	}, { wait: () => { throw new Error('HTTP failures must not wait'); } });

	assert.equal(calls, 1);
	assert.deepEqual(result, { ok: false, status: 503, attempts: 1 });
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
