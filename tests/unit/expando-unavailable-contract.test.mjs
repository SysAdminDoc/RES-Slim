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

	globalThis.__fetchHook = () => Promise.reject(new Error('403'));
	try {
		const refused = await mastodon.handleLink('https://mastodon.social/@someone/109999999999999999');
		const element = usableByScanner(refused);
		assert.match(element.className, /unavailable/);
		assert.ok(element.textContent, 'the panel says nothing to the reader');
	} finally {
		delete globalThis.__fetchHook;
	}

	globalThis.__fetchHook = () => Promise.resolve({ json: () => Promise.resolve({ nothing: true }), ok: true, status: 200 });
	try {
		const empty = await mastodon.handleLink('https://mastodon.social/@someone/109999999999999999');
		usableByScanner(empty);
	} finally {
		delete globalThis.__fetchHook;
	}
});

test('a Threads link it cannot parse gets a panel too', async () => {
	const media = await threads.handleLink('https://www.threads.com/not-a-post');
	const element = usableByScanner(media);
	assert.match(element.className, /unavailable/);
	assert.ok(element.textContent);
});

test('Bluesky answers the same way for a reply with no embed in it', async () => {
	globalThis.__fetchHook = () => Promise.resolve({ json: () => Promise.resolve({}), ok: true, status: 200 });
	try {
		const media = await bluesky.handleLink('https://bsky.app/profile/someone.bsky.social/post/abc123');
		usableByScanner(media);
	} finally {
		delete globalThis.__fetchHook;
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

