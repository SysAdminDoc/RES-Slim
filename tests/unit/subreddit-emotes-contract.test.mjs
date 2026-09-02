import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-subreddit-emotes');
fs.mkdirSync(tmpDir, { recursive: true });
const source = fs.readFileSync(path.join(repoRoot, 'lib', 'utils', 'subredditEmotes.js'), 'utf8');
const modulePath = path.join(tmpDir, 'subredditEmotes.mjs');
fs.writeFileSync(modulePath, flowRemoveTypes(source, { all: true }).toString());
const helpers = await import(pathToFileURL(modulePath).href);
const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'reddit', 'subreddit-emote-thread.json'), 'utf8'));

test('the captured signed-in response pins Reddit’s current emote metadata shape', () => {
	assert.match(fixture.capture.source, /reddit\.com\/r\/forsen\/comments/);
	const emotes = helpers.extractSubredditEmotes(fixture.response);
	assert.deepEqual(Object.keys(emotes), ['9678']);
	assert.deepEqual(emotes['9678'], {
		token: '9678',
		url: 'https://www.redditstatic.com/marketplace-assets/v1/core/emotes/snoomoji_emotes/free_emotes_pack/dizzy_face.gif',
		width: 20,
		height: 20,
	});
	assert.equal(emotes.facepalm, undefined, 'global free-pack emoji are already rendered by old Reddit');
});

test('only valid subreddit emotes hosted on Reddit enter the map', () => {
	const response = [{
		kind: 'Listing',
		data: { children: [] },
	}, {
		kind: 'Listing',
		data: {
			children: [{
				kind: 't1',
				data: {
					media_metadata: {
						'emote|t5_abc|safe_name': { s: { u: 'https://emoji.redditmedia.com/hash_t5_abc/safe_name', x: 32, y: 32 } },
						'emote|t5_abc|hostile': { s: { u: 'https://example.com/tracker.gif', x: 20, y: 20 } },
						'emote|free_emotes_pack|wave': { s: { gif: 'https://www.redditstatic.com/wave.gif', x: 20, y: 20 } },
					},
					replies: '',
				},
			}],
		},
	}];
	assert.deepEqual(helpers.extractSubredditEmotes(response), {
		safe_name: {
			token: 'safe_name',
			url: 'https://emoji.redditmedia.com/hash_t5_abc/safe_name',
			width: 32,
			height: 32,
		},
	});
});

test('known tokens split into images while unknown text remains byte-for-byte', () => {
	const map = helpers.extractSubredditEmotes(fixture.response);
	assert.deepEqual(helpers.splitEmoteText('known :9678: unknown :missing:', map).map(segment => (
		segment.type === 'text' ? [segment.type, segment.value] : [segment.type, segment.token]
	)), [
		['text', 'known '],
		['emote', ':9678:'],
		['text', ' unknown :missing:'],
	]);
	assert.deepEqual(helpers.splitEmoteText(':missing:', map), [{ type: 'text', value: ':missing:' }]);
});

test('DOM rendering preserves accessible token text and skips code and links', () => {
	const dom = new JSDOM('<div id="body"><p>known :9678: unknown :missing:</p><code>:9678:</code><a href="#">:9678:</a></div>');
	const previousDocument = globalThis.document;
	const previousNodeFilter = globalThis.NodeFilter;
	globalThis.document = dom.window.document;
	globalThis.NodeFilter = dom.window.NodeFilter;
	try {
		const root = dom.window.document.getElementById('body');
		assert.equal(helpers.renderKnownEmotes(root, helpers.extractSubredditEmotes(fixture.response)), 1);
		const image = root.querySelector('img.rsm-subredditEmote');
		assert.equal(image.alt, ':9678:');
		assert.equal(image.title, ':9678:');
		assert.equal(image.dataset.rsmSubredditEmote, '9678');
		assert.match(root.querySelector('p').textContent, /unknown :missing:/);
		assert.equal(root.querySelector('code').textContent, ':9678:');
		assert.equal(root.querySelector('a').textContent, ':9678:');
	} finally {
		globalThis.document = previousDocument;
		globalThis.NodeFilter = previousNodeFilter;
	}
});

test('cache records merge maps and expire per thread', () => {
	const now = Date.UTC(2026, 7, 21, 18, 30, 0);
	const ttl = 60 * 60 * 1000;
	const first = helpers.buildCacheRecord('Example', '/r/example/comments/one/title', {
		one: { token: 'one', url: 'https://emoji.redditmedia.com/a_t5_x/one', width: 20, height: 20 },
	}, null, now, ttl);
	const second = helpers.buildCacheRecord('Example', '/r/example/comments/two/title', {
		two: { token: 'two', url: 'https://emoji.redditmedia.com/b_t5_x/two', width: 20, height: 20 },
	}, first, now + 1000, ttl);
	assert.deepEqual(Object.keys(second.emotes), ['one', 'two']);
	assert.equal(helpers.isThreadFresh(second, '/r/example/comments/one/title', now + 2000, ttl), true);
	assert.equal(helpers.isThreadFresh(second, '/r/example/comments/one/title', now + ttl + 2000, ttl), false);
	assert.equal(helpers.isFreshRecord({ ...second, fetchedAt: now + 3000 }, now, ttl), false, 'future cache timestamps are rejected');
});

test('the opt-in old Reddit module uses bounded signed-in JSON and dashboard-accounted storage', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib', 'modules', 'index.js'), 'utf8');
	const moduleSource = fs.readFileSync(path.join(repoRoot, 'lib', 'modules', 'subredditEmotes.js'), 'utf8');
	const stores = fs.readFileSync(path.join(repoRoot, 'lib', 'utils', 'featureStores.js'), 'utf8');
	const styles = fs.readFileSync(path.join(repoRoot, 'lib', 'css', 'modules', '_subredditEmotes.scss'), 'utf8');
	assert.match(index, /import \{ module as subredditEmotes \} from '\.\/subredditEmotes';/);
	assert.match(index, /^\s*subredditEmotes,/m);
	assert.match(moduleSource, /module\.disabledByDefault = true/);
	assert.match(moduleSource, /module\.include = \['r2'\]/);
	assert.match(moduleSource, /fetchRedditJson\(/);
	assert.match(moduleSource, /raw_json=1&limit=500&depth=10/);
	assert.match(moduleSource, /watchForThings\(\['comment'\]/);
	// The store descriptor moved to the registry, and the cache is browsable and
	// purgeable from the settings console rather than from a Reddit page.
	assert.match(stores, /id: 'subredditEmotes'[\s\S]*?dbName: 'rsm-subredditEmotes', storeName: 'maps'/);
	const workspace = fs.readFileSync(path.join(repoRoot, 'lib', 'options', 'dataWorkspace.js'), 'utf8');
	assert.match(workspace, /id: 'subredditEmotes'/);
	assert.match(styles, /height: 1em/);
});
