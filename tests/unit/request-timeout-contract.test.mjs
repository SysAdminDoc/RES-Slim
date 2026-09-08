import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

// A host that accepts the connection and never answers used to hold its caller
// forever. In `showImages` that is the worst version of it: the expando button
// is inserted before `handleLink` is awaited, so every matching link on the page
// sat reading "Expando is not yet ready" for the life of the page, and because
// nothing ever rejected, `linkScanner`'s catch never ran — so the penalty box
// never counted the failure and the dead host was retried on every page load.

const redditJson = await loadFlowModule('lib/utils/redditJson.js', 'request-timeout-reddit-json');

// A stand-in for `fetch` that honours its `signal` the way the real one does:
// a request that never answers stays pending until the signal aborts, and then
// rejects. A stub that ignores the signal would leave every assertion below
// passing for the wrong reason — and would hang the file, which is how this was
// caught.
function hungFetch(record) {
	return (url, options) => new Promise((resolve, reject) => {
		if (record) record.push(options.signal);
		const fail = () => {
			const error = new Error('The operation was aborted');
			error.name = 'AbortError';
			reject(error);
		};
		if (!options.signal) return;
		if (options.signal.aborted) { fail(); return; }
		options.signal.addEventListener('abort', fail, { once: true });
	});
}

test('AbortSignal.timeout and AbortSignal.any are inside the browser floor', () => {
	// Declared in flow/lib/abort.js.flow as of 2026-09-08 against a floor of
	// chrome 125 / firefox 130. Measured on webstatus.dev the same day:
	// AbortSignal.timeout is Chrome 124 / Firefox 100.
	assert.equal(typeof AbortSignal.timeout, 'function');
	assert.equal(typeof AbortSignal.any, 'function');
});

test('a reddit read that never answers rejects instead of hanging', async () => {
	const seen = [];
	const started = Date.now();

	await assert.rejects(
		redditJson.fetchRedditJson('https://www.reddit.com/r/pics/.json', {
			timeoutMs: 60,
			fetcher: hungFetch(seen),
		}),
		/abort/i,
	);

	assert.ok(seen[0], 'the request must carry a signal at all');
	assert.ok(Date.now() - started < 5000, 'and the deadline has to be the thing that ends it');
});

test('the caller\'s own signal still cancels, and does so before the deadline', async () => {
	const controller = new AbortController();

	// Long enough that only the caller's abort can end this. The combined signal
	// has to carry that abort through, which is the half a naive
	// `signal: AbortSignal.timeout(...)` would have dropped.
	const pending = redditJson.fetchRedditJson('https://www.reddit.com/r/pics/.json', {
		timeoutMs: 60000,
		signal: controller.signal,
		fetcher: hungFetch(),
	});

	controller.abort();
	await assert.rejects(pending, /abort/i);
});

test('a timeout of zero means no deadline, and the caller\'s signal is used unchanged', async () => {
	const controller = new AbortController();
	const seen = [];

	const pending = redditJson.fetchRedditJson('https://www.reddit.com/r/pics/.json', {
		timeoutMs: 0,
		signal: controller.signal,
		fetcher: hungFetch(seen),
	});

	assert.equal(seen[0], controller.signal, 'with no deadline there is nothing to combine');
	controller.abort();
	await assert.rejects(pending, /abort/i);
});

test('a retry still gets a fresh deadline rather than sharing the first one', async () => {
	// The deadline is per attempt: a 429 backoff legitimately takes longer than
	// one request should, so a per-operation deadline would turn a retry into a
	// guaranteed failure.
	const signals = [];
	let calls = 0;

	const result = await redditJson.fetchRedditJson('https://www.reddit.com/r/pics/.json', {
		timeoutMs: 5000,
		backoffMs: 1,
		sleep: () => Promise.resolve(),
		fetcher: (url, options) => {
			signals.push(options.signal);
			calls += 1;
			if (calls === 1) return Promise.resolve({ ok: false, status: 429, headers: { get: () => '' } });
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: { get: name => (name === 'content-type' ? 'application/json' : '') },
				json: () => Promise.resolve({ data: 'ok' }),
			});
		},
	});

	assert.deepEqual(result, { data: 'ok' });
	assert.equal(signals.length, 2, 'the 429 should have been retried');
	assert.notEqual(signals[0], signals[1], 'each attempt needs its own deadline');
});
