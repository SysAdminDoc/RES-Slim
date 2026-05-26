import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/index.js'), 'utf8');
const readHost = host => fs.readFileSync(path.join(repoRoot, `lib/modules/hosts/${host}.js`), 'utf8');

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
	assert.ok(src.includes('/profile\\/[\\w.-]+\\/post\\/[\\w.-]+'), 'full Bluesky post path');
	assert.match(src, /typeof post\.html !== 'string'/);
});
