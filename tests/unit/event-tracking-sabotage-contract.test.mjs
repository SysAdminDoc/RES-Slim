import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const { pageScript } = await loadFlowModule('lib/utils/eventTrackingSabotage.js', 'event-tracking-sabotage');

const HOSTS = [
	'events.reddit.com',
	'events.redditmedia.com',
	'pixel.redditmedia.com',
	'e.reddit.com',
	'alb.reddit.com',
	'w3-reporting.reddit.com',
];
const PATHS = ['/api/event', '/api/v1/page_view', '/api/v1/clk'];

// Build the page world the injected script expects, run the script in it, and
// hand back the wrapped globals plus a record of what reached the originals.
// A source-text assertion cannot tell you whether a blocker blocks; this can.
function runPageScript({ log = false } = {}) {
	const reachedOriginal = { fetch: [], beacon: [], xhr: [] };

	class FakeXHR {
		open(method, url) { this._url = url; }
		send() { reachedOriginal.xhr.push(this._url); }
		dispatchEvent() {}
	}

	const sandbox = {
		location: { href: 'https://old.reddit.com/r/aww/comments/abc/' },
		navigator: {
			sendBeacon(url) { reachedOriginal.beacon.push(String(url)); return true; },
		},
		window: {
			fetch(input) {
				// Read defensively: one test hands in an object whose `url` getter
				// throws, and a stub that rethrows would mask what is being measured.
				let recorded;
				try { recorded = typeof input === 'string' ? input : (input && input.url); } catch (e) { recorded = '<unreadable>'; }
				reachedOriginal.fetch.push(recorded);
				return Promise.resolve(new Response('real', { status: 200 }));
			},
		},
		XMLHttpRequest: FakeXHR,
		URL,
		Response,
		Event: class { constructor(type) { this.type = type; } },
		Object,
		Promise,
		TypeError,
		setTimeout,
		console: { warn: (...args) => { sandbox.__warnings.push(args.join(' ')); } },
		__warnings: [],
	};

	vm.createContext(sandbox);
	vm.runInContext(pageScript(HOSTS, PATHS, log), sandbox);

	return { sandbox, reachedOriginal };
}

test('a tracker fetch never reaches the original fetch', async () => {
	// The regression: `new Response('', { status: 204 })` throws because 204 is a
	// null-body status, the bare `catch` swallowed it, and execution fell through
	// to `origFetch`. The module shipped that way for its whole life with a green
	// source-regex contract.
	const { sandbox, reachedOriginal } = runPageScript();

	const response = await sandbox.window.fetch('https://events.reddit.com/v1');
	assert.deepEqual(reachedOriginal.fetch, [], 'the tracker request was forwarded to the real fetch');
	assert.equal(response.status, 204);
	assert.equal(await response.text(), '');
});

test('the 204 construction that used to throw is exercised, not asserted about', () => {
	// Proves the bug was real and that the test would catch its return.
	assert.throws(() => new Response('', { status: 204 }), TypeError);
	assert.equal(new Response(null, { status: 204 }).status, 204);
});

test('every tracker host and analytics path is blocked', async () => {
	const { sandbox, reachedOriginal } = runPageScript();

	for (const host of HOSTS) {
		// eslint-disable-next-line no-await-in-loop
		await sandbox.window.fetch(`https://${host}/collect`);
		// A subdomain of a tracker host counts too.
		// eslint-disable-next-line no-await-in-loop
		await sandbox.window.fetch(`https://cdn.${host}/collect`);
	}
	for (const path of PATHS) {
		// eslint-disable-next-line no-await-in-loop
		await sandbox.window.fetch(`https://www.reddit.com${path}`);
		// eslint-disable-next-line no-await-in-loop
		await sandbox.window.fetch(`https://www.reddit.com${path}/extra`);
	}

	assert.deepEqual(reachedOriginal.fetch, []);
});

test('ordinary reddit traffic is left alone', async () => {
	// A blocker that swallows real requests breaks the site, so the negative case
	// matters as much as the positive one.
	const { sandbox, reachedOriginal } = runPageScript();

	const allowed = [
		'https://www.reddit.com/api/me.json',
		'https://old.reddit.com/r/aww/.json',
		'https://i.redd.it/abc.jpg',
		'/api/hide',
		'https://www.reddit.com/api/eventual', // shares a prefix with /api/event
	];
	for (const url of allowed) {
		// eslint-disable-next-line no-await-in-loop
		await sandbox.window.fetch(url);
	}

	assert.deepEqual(reachedOriginal.fetch, allowed);
});

test('a Request object is matched by its url, not stringified', async () => {
	const { sandbox, reachedOriginal } = runPageScript();
	await sandbox.window.fetch({ url: 'https://events.reddit.com/v1', method: 'POST' });
	assert.deepEqual(reachedOriginal.fetch, []);
});

test('sendBeacon is blocked and reports success to the caller', () => {
	const { sandbox, reachedOriginal } = runPageScript();

	assert.equal(sandbox.navigator.sendBeacon('https://events.reddit.com/v1', 'x'), true);
	assert.deepEqual(reachedOriginal.beacon, []);

	sandbox.navigator.sendBeacon('https://www.reddit.com/api/me.json', 'x');
	assert.deepEqual(reachedOriginal.beacon, ['https://www.reddit.com/api/me.json']);
});

test('a tracker XHR never reaches the original send', () => {
	const { sandbox, reachedOriginal } = runPageScript();

	const blocked = new sandbox.XMLHttpRequest();
	blocked.open('POST', 'https://events.reddit.com/v1');
	blocked.send('payload');
	assert.deepEqual(reachedOriginal.xhr, []);

	const allowed = new sandbox.XMLHttpRequest();
	allowed.open('GET', 'https://www.reddit.com/api/me.json');
	allowed.send();
	assert.deepEqual(reachedOriginal.xhr, ['https://www.reddit.com/api/me.json']);
});

test('a failure to classify is reported, and fails open rather than silently', async () => {
	// The original `catch (_) {}` is exactly why nobody noticed the module was
	// inert. A request we cannot classify still has to go through — dropping it
	// would break the site — but it must say so.
	const { sandbox, reachedOriginal } = runPageScript();
	const hostile = { get url() { throw new Error('boom'); } };

	await sandbox.window.fetch(hostile);

	assert.ok(
		sandbox.__warnings.some(w => w.includes('tracking sabotage failed')),
		`expected a failure warning, got: ${JSON.stringify(sandbox.__warnings)}`,
	);
	assert.equal(reachedOriginal.fetch.length, 1, 'an unclassifiable request must still reach the network');
});

test('logging is off by default and honoured when on', async () => {
	const quiet = runPageScript({ log: false });
	await quiet.sandbox.window.fetch('https://events.reddit.com/v1');
	assert.deepEqual(quiet.sandbox.__warnings, []);

	const loud = runPageScript({ log: true });
	await loud.sandbox.window.fetch('https://events.reddit.com/v1');
	assert.ok(loud.sandbox.__warnings.some(w => w.includes('blocked beacon')));
});

test('eventTrackingSabotage is registered and injects the page script', () => {
	const index = readRepoFile('lib/modules/index.js');
	assert.match(index, /import \{ module as eventTrackingSabotage \} from '\.\/eventTrackingSabotage';/);
	assert.match(index, /^\s*eventTrackingSabotage,/m);

	const source = readRepoFile('lib/modules/eventTrackingSabotage.js');
	assert.match(source, /document\.createElement\('script'\)/);
	assert.match(source, /script\.remove\(\)/);
	assert.match(source, /module\.category\s*=\s*'privacyCategory'/);
	assert.match(source, /module\.include\s*=\s*\['r2'\]/);
});

test('the module still owns the tracker lists', () => {
	// The lists are the reviewed surface; they must stay where a reader looking at
	// the module can see them, not drift into the helper.
	const source = readRepoFile('lib/modules/eventTrackingSabotage.js');
	for (const host of HOSTS) assert.ok(source.includes(`'${host}'`), `expected host ${host}`);
	for (const path of PATHS) assert.ok(source.includes(`'${path}'`), `expected path ${path}`);
});
