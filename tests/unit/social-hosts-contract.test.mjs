import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/index.js'), 'utf8');

test('mastodon host is registered', () => {
	assert.match(indexSource, /import mastodon from '\.\/mastodon';/);
	assert.match(indexSource, /^\s*mastodon,/m);
});

test('threads host is registered', () => {
	assert.match(indexSource, /import threads from '\.\/threads';/);
	assert.match(indexSource, /^\s*threads,/m);
});

test('mastodon detects both username and statuses URL shapes', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/mastodon.js'), 'utf8');
	assert.ok(src.includes('/@[\\w-]+'), 'username shape');
	assert.ok(src.includes('/users\\/[\\w-]+\\/statuses\\/'), 'statuses shape');
});

test('mastodon ships permissions for known instances', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/mastodon.js'), 'utf8');
	for (const host of ['mastodon.social', 'mastodon.online', 'fosstodon.org', 'hachyderm.io', 'mas.to', 'infosec.exchange']) {
		assert.ok(src.includes(host), `expected known instance ${host}`);
	}
});

test('mastodon uses the federated oembed endpoint at the post instance', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/mastodon.js'), 'utf8');
	assert.match(src, /\/api\/oembed/);
	assert.match(src, /parsed\.instance/);
});

test('threads embed builds the documented /embed suffix URL', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/threads.js'), 'utf8');
	assert.match(src, /\/post\/\$\{id\}\/embed/);
	assert.match(src, /threads\.com/);
	assert.match(src, /threads\.net/);
});

test('threads ships permissions for both threads.com and threads.net', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/threads.js'), 'utf8');
	assert.match(src, /https:\/\/www\.threads\.com\/\*/);
	assert.match(src, /https:\/\/www\.threads\.net\/\*/);
});

test('mastodon never blocks the page when the oembed call fails', () => {
	const src = fs.readFileSync(path.join(repoRoot, 'lib/modules/hosts/mastodon.js'), 'utf8');
	assert.match(src, /try\s*\{\s*post\s*=\s*await ajax\(/);
	assert.match(src, /catch \(e\) \{/);
});
