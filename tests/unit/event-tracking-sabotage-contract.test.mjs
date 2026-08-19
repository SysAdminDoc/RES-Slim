import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const { installSabotage, TRACKER_HOSTS, TRACKER_PATHS } = await loadFlowModule('lib/utils/eventTrackingSabotage.js', 'event-tracking-sabotage');

const HOSTS = [
	'events.reddit.com',
	'events.redditmedia.com',
	'pixel.redditmedia.com',
	'e.reddit.com',
	'alb.reddit.com',
	'w3-reporting.reddit.com',
];
const PATHS = ['/api/event', '/api/v1/page_view', '/api/v1/clk'];

// Build the page world the patch expects, install into it, and hand back the
// wrapped globals plus a record of what reached the originals.
//
// This used to build the patch as a source string and run it through `node:vm`,
// which is exactly how the module stayed inert for its whole life: the string
// was correct and it was never delivered. `installSabotage` is the function the
// shipped page-world entry calls, so what runs here is what runs in the browser.
// Delivery is now the e2e's job, since nothing in Node can observe a CSP.
function runPageScript({ log = false } = {}) {
	const reachedOriginal = { fetch: [], beacon: [], xhr: [] };
	const warnings = [];

	class FakeXHR {
		open(method, url) { this._url = url; }
		send() { reachedOriginal.xhr.push(this._url); }
		dispatchEvent() {}
	}

	const scope = {
		location: { href: 'https://old.reddit.com/r/aww/comments/abc/' },
		navigator: {
			sendBeacon(url) { reachedOriginal.beacon.push(String(url)); return true; },
		},
		fetch(input) {
			// Read defensively: one test hands in an object whose `url` getter
			// throws, and a stub that rethrows would mask what is being measured.
			let recorded;
			try { recorded = typeof input === 'string' ? input : (input && input.url); } catch (e) { recorded = '<unreadable>'; }
			reachedOriginal.fetch.push(recorded);
			return Promise.resolve(new Response('real', { status: 200 }));
		},
		XMLHttpRequest: FakeXHR,
		URL,
		Response,
		Event: class { constructor(type) { this.type = type; } },
		setTimeout,
		console: { warn: (...args) => { warnings.push(args.join(' ')); } },
	};

	installSabotage(scope, HOSTS, PATHS, log);

	// The old vm sandbox patched `window.fetch`; `scope` is the window now, so
	// keep the shape the assertions below already read.
	return { sandbox: { ...scope, window: scope, __warnings: warnings }, reachedOriginal };
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

test('eventTrackingSabotage is registered and injects a packaged file, not inline source', () => {
	const index = readRepoFile('lib/modules/index.js');
	assert.match(index, /import \{ module as eventTrackingSabotage \} from '\.\/eventTrackingSabotage';/);
	assert.match(index, /^\s*eventTrackingSabotage,/m);

	const source = readRepoFile('lib/modules/eventTrackingSabotage.js');
	assert.match(source, /document\.createElement\('script'\)/);
	// The bait for the delivery e2e. `textContent` is the shape MV3 rejects, and
	// the whole defect was that nothing anywhere could tell the two apart.
	assert.doesNotMatch(source, /script\.textContent\s*=/, 'an inline page script is blocked by the extension CSP; use a web-accessible file');
	assert.match(source, /script\.src = getURL\(PAGE_SCRIPT\)/);
	assert.match(source, /module\.category\s*=\s*'privacyCategory'/);
	// Both renderers since v0.45.0. The patch is page-world only and touches no
	// DOM, and current Reddit beacons to the same hosts more often than old
	// Reddit does, so scoping it to r2 left the noisier renderer untouched.
	assert.match(source, /module\.include\s*=\s*\['r2', 'd2x'\]/);
});

test('the page script is packaged, web-accessible on both targets, and size-tracked', () => {
	const build = readRepoFile('build.js');
	assert.match(build, /'trackingSabotage\.entry': '\.\/lib\/pageWorld\/trackingSabotage\.entry\.js'/);
	// A new entry that no ratchet watches is a bundle that can grow without
	// anyone noticing, which is the failure the ratchet exists to catch.
	assert.match(build, /'trackingSabotage\.entry\.js',/);

	for (const manifest of ['chrome/manifest.json', 'firefox/manifest.json']) {
		const parsed = JSON.parse(readRepoFile(manifest));
		const resources = parsed.web_accessible_resources.flatMap(entry => (typeof entry === 'string' ? [entry] : entry.resources));
		assert.ok(
			resources.includes('trackingSabotage.entry.js'),
			`${manifest} must expose the page script, or the page cannot load it`,
		);
	}
});

test('the tracker lists stay in the page-world source, and are what the entry ships', () => {
	// The lists are the reviewed surface. They moved out of the module when the
	// module stopped building the script's text — but they must stay somewhere a
	// reader can see them, and they must be the ones actually compiled in.
	assert.deepEqual(TRACKER_HOSTS, HOSTS);
	assert.deepEqual(TRACKER_PATHS, PATHS);

	const source = readRepoFile('lib/utils/eventTrackingSabotage.js');
	for (const host of HOSTS) assert.ok(source.includes(`'${host}'`), `expected host ${host}`);
	for (const path of PATHS) assert.ok(source.includes(`'${path}'`), `expected path ${path}`);

	const entry = readRepoFile('lib/pageWorld/trackingSabotage.entry.js');
	assert.match(entry, /installSabotage\(window, TRACKER_HOSTS, TRACKER_PATHS, logBlocked\)/);
	// Handing the lists over on a data attribute would let a page script empty
	// them before this runs. Only the log flag crosses that way.
	assert.doesNotMatch(entry, /dataset\.resSlimSabotageHosts|dataset\.resSlimSabotagePaths/);
});

test('the paths this patches are the paths the packaged rules block', () => {
	// The two layers are deliberately redundant, and redundancy is only worth
	// having while both halves name the same targets.
	const rules = JSON.parse(readRepoFile('rules/ad-block.json'));
	const hostRule = rules.find(rule => rule.condition.requestDomains?.includes('events.reddit.com'));
	assert.ok(hostRule, 'the tracker hosts must still be blocked at the network layer');
	for (const host of TRACKER_HOSTS) {
		assert.ok(hostRule.condition.requestDomains.includes(host), `${host} is patched but not blocked`);
	}

	const pathRules = rules.filter(rule => rule.condition.regexFilter);
	for (const path of TRACKER_PATHS) {
		const url = `https://www.reddit.com${path}`;
		assert.ok(
			pathRules.some(rule => new RegExp(rule.condition.regexFilter).test(url)),
			`${path} is patched in the page but not blocked at the network layer`,
		);
	}
});
