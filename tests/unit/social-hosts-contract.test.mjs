import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadModule } from './helpers/loadModule.mjs';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/index.js'), 'utf8');
const readHost = host => fs.readFileSync(path.join(repoRoot, `lib/modules/hosts/${host}.js`), 'utf8');

async function loadHost(name, label) {
	const { __targetDefault } = await loadModule(`lib/modules/hosts/${name}.js`, label, {
		stubEnvironment: true,
		exportDefault: true,
	});
	return __targetDefault;
}

const { assertSafeMediaUrls } = await loadFlowModule('lib/utils/mediaUrl.js', 'social-hosts-media-url');

test('mastodon host is registered', () => {
	assert.match(indexSource, /import mastodon from '\.\/mastodon';/);
	assert.match(indexSource, /^\s*mastodon,/m);
});

test('threads host is registered', () => {
	assert.match(indexSource, /import threads from '\.\/threads';/);
	assert.match(indexSource, /^\s*threads,/m);
});

test('mastodon detects both username and statuses URL shapes', () => {
	const src = readHost('mastodon');
	assert.ok(src.includes('/@[\\w-]+'), 'username shape');
	assert.ok(src.includes('/users\\/[\\w-]+\\/statuses\\/'), 'statuses shape');
});

test('mastodon ships permissions for known instances', () => {
	const src = readHost('mastodon');
	for (const host of ['mastodon.social', 'mastodon.online', 'fosstodon.org', 'hachyderm.io', 'mas.to', 'infosec.exchange']) {
		assert.ok(src.includes(host), `expected known instance ${host}`);
	}
});

test('mastodon uses the federated oembed endpoint at the post instance', () => {
	const src = readHost('mastodon');
	assert.match(src, /\/api\/oembed/);
	assert.match(src, /parsed\.instance/);
});

test('threads embed builds the documented /embed suffix URL', () => {
	const src = readHost('threads');
	assert.match(src, /\/post\/\$\{id\}\/embed/);
	assert.match(src, /threads\.com/);
	assert.match(src, /threads\.net/);
});

// The source assertion above passed for this handler's whole life while every
// Threads link refused to render: `embed` was a nested media object, and both
// consumers want the URL string. `assertSafeMediaUrls` rejects a non-string
// `embed`, and the expand handler swallows that throw, so the only symptom was a
// button that did nothing. Run the handler and put its result through the guard.
test('a threads link produces an embed URL the media scheme guard accepts', async () => {
	const threads = await loadHost('threads', 'threads-embed-shape');

	const cases = [
		['https://www.threads.com/@zuck/post/C1abc', 'https://www.threads.com/@zuck/post/C1abc/embed'],
		['https://threads.net/@someone/post/XyZ_9-8', 'https://www.threads.net/@someone/post/XyZ_9-8/embed'],
	];
	const built = await Promise.all(cases.map(([href]) => threads.handleLink(href)));

	cases.forEach(([href, expected], i) => {
		const media = built[i];
		assert.equal(media.type, 'IFRAME', href);
		assert.equal(typeof media.embed, 'string', 'embed must be the URL itself, not a wrapper object');
		assert.equal(media.embed, expected);
		// `iframeTemplate` writes these into a `style` attribute, so they have to
		// carry units rather than be bare numbers.
		assert.equal(media.width, '540px');
		assert.equal(media.height, '720px');
		assert.doesNotThrow(() => assertSafeMediaUrls(media, 'https://www.reddit.com/'));
	});

	// Positive control for the assertion above: the shape this handler used to
	// return really is refused, so a regression cannot pass this test quietly.
	assert.throws(
		() => assertSafeMediaUrls(
			{ type: 'IFRAME', embed: { type: 'IFRAME', src: 'https://www.threads.com/@zuck/post/C1abc/embed' } },
			'https://www.reddit.com/',
		),
		/unsupported URL scheme/,
	);
});

test('threads ships permissions for both threads.com and threads.net', () => {
	const src = readHost('threads');
	assert.match(src, /https:\/\/www\.threads\.com\/\*/);
	assert.match(src, /https:\/\/www\.threads\.net\/\*/);
});

test('mastodon never blocks the page when the oembed call fails', () => {
	const src = readHost('mastodon');
	assert.match(src, /try\s*\{\s*post\s*=\s*await ajax\(/);
	assert.match(src, /catch \(e\) \{/);
});

test('oEmbed social handlers sanitize remote HTML before attaching', () => {
	for (const host of ['twitter', 'mastodon', 'bluesky']) {
		const src = readHost(host);
		assert.match(src, /import DOMPurify from 'dompurify'/, `${host} should import DOMPurify`);
		assert.match(src, /setTrustedHTML\(dummy, sanitized\)/, `${host} should write via TrustedHTML helper`);
		assert.doesNotMatch(src, /\.html\((?:html|post\.html)\)/, `${host} should not attach raw oEmbed HTML`);
	}
});

test('bluesky detects full post URLs and validates oEmbed payload shape', () => {
	const src = readHost('bluesky');
	assert.match(src, /typeof post\.html !== 'string'/);

	// Pull the shipped regex out and run it rather than pinning its text: the
	// previous version of this test asserted an exact character class, so it
	// failed on a deliberate widening while telling you nothing about behaviour.
	// Rebuilt with `new RegExp` from the captured body and flags rather than
	// eval’d, so this never executes source text from the file it is checking.
	const literal = src.match(/detect: \(\{ href \}\) => \(\/(.*)\/([a-z]*)\)\.exec\(href\)/);
	assert.ok(literal, 'could not find the detect regex');
	const detect = new RegExp(literal[1], literal[2]);

	assert.ok(detect.test('https://bsky.app/profile/user.bsky.social/post/3kabc123'), 'handle-addressed post');
	// bsky also serves post URLs addressed by DID, which contains colons. A
	// [\w.-] profile class excluded those, so they were never detected at all
	// (upstream #5561).
	assert.ok(detect.test('https://bsky.app/profile/did:plc:abc123xyz/post/3kabc123'), 'DID-addressed post');
	assert.ok(detect.test('https://bsky.app/profile/user.bsky.social/post/3kabc123?ref=x'), 'query string');
	assert.ok(detect.test('https://bsky.app/profile/user.bsky.social/post/3kabc123/'), 'trailing slash');

	// Still narrow enough to reject non-posts.
	assert.equal(detect.test('https://bsky.app/profile/user.bsky.social'), false, 'profile page is not a post');
	assert.equal(detect.test('https://bsky.app/profile/a/post/b/extra'), false, 'trailing path');
	assert.equal(detect.test('https://example.com/profile/a/post/b'), false, 'wrong host');
});
