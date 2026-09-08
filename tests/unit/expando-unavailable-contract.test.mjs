// A post that cannot be embedded is not a broken host.
//
// `handleLink` returning `undefined` reads as "no media", and the scanner then
// does `mediaOptions.title` on it. That is a TypeError, the catch above records
// it against the host, and `PenaltyBox` suspends the host after enough of them.
// So a run of private, deleted or sign-in-walled posts takes a working instance
// off the reader for the rest of the suspension, and every later link from it
// silently loses its expando.
//
// Bluesky already answered with a panel that says so. Mastodon and Threads
// answered with `undefined` in four places between them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';
import { readRepoFile } from './helpers/loadFlowModule.mjs';

async function host(file, label) {
	const { __targetDefault } = await loadModule(file, label, { stubEnvironment: true, exportDefault: true });
	return __targetDefault;
}

const mastodon = await host('lib/modules/hosts/mastodon.js', 'mastodon-unavailable');
const threads = await host('lib/modules/hosts/threads.js', 'threads-unavailable');
const bluesky = await host('lib/modules/hosts/bluesky.js', 'bluesky-unavailable');

// What the scanner does with whatever comes back, reduced to the part that
// matters: it reads a property off it, and it attaches it.
function usableByScanner(media) {
	assert.ok(media, 'the handler returned nothing, which the scanner reads as a failure');
	assert.doesNotThrow(() => String(media.title), 'the scanner cannot read a title off this');
	assert.equal(typeof media.generate, 'function');
	const element = media.generate();
	assert.ok(element, 'nothing to attach');
	if (media.onAttach) media.onAttach();
	return element;
}

test('a Mastodon post that cannot be fetched gets a panel, not a thrown scanner', async () => {
	// The three ways this handler used to answer `undefined`: a URL it cannot
	// parse, an instance that refuses, and a reply with no HTML in it.
	const unparseable = await mastodon.handleLink('https://mastodon.social/not-a-post');
	usableByScanner(unparseable);

	// A 4xx is an answer about the post: private, deleted, or behind a login.
	globalThis.__resSlimAjax = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
	try {
		const refused = await mastodon.handleLink('https://mastodon.social/@someone/109999999999999999');
		const element = usableByScanner(refused);
		assert.match(element.className, /unavailable/);
		assert.ok(element.textContent, 'the panel says nothing to the reader');
	} finally {
		delete globalThis.__resSlimAjax;
	}

	globalThis.__resSlimAjax = () => Promise.resolve({ nothing: true });
	try {
		const empty = await mastodon.handleLink('https://mastodon.social/@someone/109999999999999999');
		usableByScanner(empty);
	} finally {
		delete globalThis.__resSlimAjax;
	}
});

test('a Threads link it cannot parse gets a panel too', async () => {
	const media = await threads.handleLink('https://www.threads.com/not-a-post');
	const element = usableByScanner(media);
	assert.match(element.className, /unavailable/);
	assert.ok(element.textContent);
});

test('Bluesky answers the same way for a reply with no embed in it', async () => {
	globalThis.__resSlimAjax = () => Promise.resolve({});
	try {
		const media = await bluesky.handleLink('https://bsky.app/profile/someone.bsky.social/post/abc123');
		usableByScanner(media);
	} finally {
		delete globalThis.__resSlimAjax;
	}
});

test('no social handler answers with undefined any more', () => {
	// The shape of the bug rather than its instances: any `return undefined` on
	// one of these paths is the same TypeError again, and there were four.
	const sources = {
		mastodon: 'lib/modules/hosts/mastodon.js',
		threads: 'lib/modules/hosts/threads.js',
		bluesky: 'lib/modules/hosts/bluesky.js',
	};
	for (const [name, file] of Object.entries(sources)) {
		const source = readRepoFile(file);
		const handler = source.slice(source.indexOf('handleLink'));
		assert.ok(
			!/return undefined;/.test(handler),
			`${name} still answers undefined, which the scanner records as a host failure`,
		);
		assert.match(handler, /unavailable(Media|Embed)?\(\)/, `${name} never returns a panel`);
	}
});

test('an instance that is down is still reported as a host that is down', async () => {
	// A panel counts as success, so answering one for every failure hides an
	// outage from the penalty box -- and the penalty box exists because a host
	// that is down otherwise costs one dead round trip per link, on every page,
	// indefinitely. It also tells the reader the post is unavailable when what is
	// unavailable is the instance.
	const hostLevel = [
		Object.assign(new Error('Internal Server Error'), { status: 500 }),
		Object.assign(new Error('Bad Gateway'), { status: 502 }),
		new Error('NetworkError when attempting to fetch resource.'),
		Object.assign(new Error('nonsense'), { status: 'teapot' }),
	];

	for (const failure of hostLevel) {
		globalThis.__resSlimAjax = () => Promise.reject(failure);
		try {
			// eslint-disable-next-line no-await-in-loop
			await assert.rejects(
				() => mastodon.handleLink('https://mastodon.social/@someone/109999999999999999'),
				`a ${String(failure.status || 'network')} failure was answered with a panel`,
			);
			// eslint-disable-next-line no-await-in-loop
			await assert.rejects(() => bluesky.handleLink('https://bsky.app/profile/someone.bsky.social/post/abc123'));
		} finally {
			delete globalThis.__resSlimAjax;
		}
	}

	// And every 4xx is still the post rather than the host.
	for (const status of [400, 403, 404, 410, 451, 499]) {
		globalThis.__resSlimAjax = () => Promise.reject(Object.assign(new Error(String(status)), { status }));
		try {
			// eslint-disable-next-line no-await-in-loop
			const media = await mastodon.handleLink('https://mastodon.social/@someone/109999999999999999');
			usableByScanner(media);
		} finally {
			delete globalThis.__resSlimAjax;
		}
	}
});

test('a dead instance stands down that instance and not the whole host', async () => {
	// Mastodon is not one host, it is every server in the list and any other one a
	// reader has granted. The rethrow above is what puts a dead instance in the
	// penalty box, and with a key of `mastodon` it put all of them there.
	const url = href => new URL(href);
	assert.equal(typeof mastodon.penaltyKey, 'function', 'mastodon counts failures against the whole host');

	const fosstodon = mastodon.penaltyKey(url('https://fosstodon.org/@a/1'));
	const social = mastodon.penaltyKey(url('https://mastodon.social/@a/1'));
	assert.notEqual(fosstodon, social, 'two instances share one suspension');
	assert.equal(fosstodon, mastodon.penaltyKey(url('https://fosstodon.org/@b/2')), 'two links to one instance are counted apart');
	// Namespaced, so an instance can never collide with another handler's id.
	assert.match(fosstodon, /^mastodon:/);

	// A host that is one server says nothing, and the scanner falls back to the
	// module id. Checked on a real host rather than asserted about the default.
	const bluesky2 = await host('lib/modules/hosts/bluesky.js', 'bluesky-penalty-default');
	assert.equal(bluesky2.penaltyKey, undefined, 'a single-server host opted into a per-link key');
	assert.equal(bluesky2.moduleID, 'bluesky');
});

test('the panel a link gets is the button that link would have had', () => {
	// The same link showing a video icon when it plays and a text icon when it
	// does not is a difference the reader has to explain to themselves.
	const threadsSource = readRepoFile('lib/modules/hosts/threads.js');
	assert.match(threadsSource, /expandoClass: 'video-classic-expando-button'/);
	// Twice: once on the working embed, once on the panel that replaces it.
	assert.equal((threadsSource.match(/video-classic-expando-button/g) || []).length, 2);
});
