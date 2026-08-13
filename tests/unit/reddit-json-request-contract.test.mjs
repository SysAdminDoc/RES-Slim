import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const Json = await loadFlowModule('lib/utils/redditJson.js', 'reddit-json');

function response(status, value, { contentType = 'application/json; charset=utf-8', parseError = null, retryAfter = '' } = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: {
			get(name) {
				if (name.toLowerCase() === 'content-type') return contentType;
				if (name.toLowerCase() === 'retry-after') return retryAfter;
				return '';
			},
		},
		async json() {
			if (parseError) throw parseError;
			return value;
		},
	};
}

const listing = children => ({ data: { children } });
const pair = [listing([{ kind: 't3', data: { name: 't3_public' } }]), listing([])];

test('a valid 200 response includes credentials and passes an explicit shape guard', async () => {
	let request;
	const value = await Json.fetchRedditJson('/r/example/comments/public.json', {
		fetcher: async (url, options) => {
			request = { url, options };
			return response(200, pair);
		},
		validate: Json.isRedditListingPair,
	});
	assert.deepEqual(value, pair);
	assert.equal(request.options.credentials, 'include');
	assert.equal(request.options.headers.Accept, 'application/json');
});

test('content type, parser, and payload shape failures stay distinct and body-free', async () => {
	await assert.rejects(
		Json.fetchRedditJson('/public.json', { fetcher: async () => response(200, pair, { contentType: 'text/html' }) }),
		error => error.code === 'content-type' && !error.message.includes('t3_public'),
	);
	await assert.rejects(
		Json.fetchRedditJson('/public.json', { fetcher: async () => response(200, null, { parseError: new SyntaxError('bait payload') }) }),
		error => error.code === 'malformed-json' && !error.message.includes('bait payload'),
	);
	await assert.rejects(
		Json.fetchRedditJson('/public.json', { fetcher: async () => response(200, 'not a container') }),
		error => error.code === 'shape',
	);
});

test('401 and 403 are reported once and never retried', async () => {
	for (const status of [401, 403]) {
		let calls = 0;
		const reported = [];
		await assert.rejects(Json.fetchRedditJson('/private.json', {
			fetcher: async () => { calls += 1; return response(status, null); },
			onStatus: value => reported.push(value),
			sleep: async () => { throw new Error('forbidden responses must not retry'); },
		}), error => error.status === status);
		assert.equal(calls, 1);
		assert.deepEqual(reported, [status]);
	}
});

test('429 retries use bounded backoff and stop at the configured budget', async () => {
	let calls = 0;
	const waits = [];
	const reported = [];
	const value = await Json.fetchRedditJson('/public.json', {
		fetcher: async () => {
			calls += 1;
			return calls < 3 ? response(429, null, { retryAfter: '0' }) : response(200, pair);
		},
		validate: Json.isRedditListingPair,
		maxRetries: 2,
		backoffMs: 100,
		maxBackoffMs: 150,
		sleep: async delay => { waits.push(delay); },
		onStatus: status => reported.push(status),
	});
	assert.deepEqual(value, pair);
	assert.equal(calls, 3);
	assert.deepEqual(waits, [100, 150]);
	assert.deepEqual(reported, [429, 429]);

	calls = 0;
	await assert.rejects(Json.fetchRedditJson('/public.json', {
		fetcher: async () => { calls += 1; return response(429, null); },
		maxRetries: 1,
		sleep: async () => {},
	}), error => error.status === 429);
	assert.equal(calls, 2, 'one retry means two total attempts');
	assert.equal(Json.retryDelayMs(4, '120', 100, 1000), 1000, 'server hints cannot escape the delay cap');
});

test('a request scope aborts a pending retry and page teardown signals are wired', async () => {
	const scope = Json.createRedditRequestScope();
	const pending = Json.fetchRedditJson('/public.json', {
		fetcher: async () => response(429, null),
		maxRetries: 1,
		signal: scope.signal,
		sleep: async (delay, signal) => {
			scope.abort();
			return Json.sleepWithAbort(delay, signal);
		},
	});
	await assert.rejects(pending, error => error.name === 'AbortError');
	const bodyAbort = new Error('body read aborted');
	bodyAbort.name = 'AbortError';
	await assert.rejects(
		Json.fetchRedditJson('/public.json', {
			fetcher: async () => response(200, null, { parseError: bodyAbort }),
		}),
		error => error === bodyAbort,
		'aborting after headers but before body completion must not be mislabeled as malformed JSON',
	);
	const source = read('lib/utils/redditJson.js');
	assert.match(source, /addEventListener\('pagehide'/);
	assert.match(source, /addEventListener\('reddit\.urlChanged'/);
});

test('all authenticated Reddit JSON call sites share the helper', () => {
	for (const file of [
		'lib/modules/autoRefreshComments.js',
		'lib/modules/authorContextBadge.js',
		'lib/modules/commentTreeExport.js',
		'lib/modules/crosspostMap.js',
		'lib/modules/galleryZip.js',
		'lib/modules/savedBackup.js',
		'lib/modules/searchGallery.js',
		'lib/modules/topCommentsPreview.js',
		'lib/utils/subRules.js',
	]) {
		const source = read(file);
		assert.match(source, /fetchRedditJson\(/, `${file} must use the shared helper`);
		assert.doesNotMatch(source, /credentials:\s*['"]include['"]/, `${file} must not duplicate credentials policy`);
	}
});
