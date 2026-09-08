import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

// The response cache is shared by every tab, and several of the things it caches
// are fetched with `credentials: 'include'` against reddit — the logged-in
// user's own name and modhash among them. Keyed on the bare URL, a private
// window's response was served to a normal window and back again.
//
// `multicast.js`, in the same directory, already partitions by the same property
// for the same reason; this one ignored its sender entirely.

// The policy lives in `lib/utils/` precisely so it can be run here; the
// background file is three lines of `chrome.runtime` wiring around it.
const { applyCacheOperation, cacheContext } = await loadFlowModule(
	'lib/utils/xhrCacheScope.js',
	'xhr-cache-scope',
	{ deps: ['lib/utils/Cache.js'] },
);

const { LRUCache } = await loadFlowModule('lib/utils/Cache.js', 'xhr-cache-scope-lru');

const normalTab = { tab: { id: 1, incognito: false, cookieStoreId: 'firefox-default' } };
const privateTab = { tab: { id: 2, incognito: true, cookieStoreId: 'firefox-private' } };

const set = (cache, sender, key, value) => applyCacheOperation(cache, ['set', key, value], sender);
const check = (cache, sender, key, maxAge) => applyCacheOperation(cache, ['check', key, maxAge], sender);

test('a private window and a normal window do not share cached responses', () => {
	const cache = new LRUCache(512);
	const key = 'GET|include|https://www.reddit.com/api/me.json';

	set(cache, privateTab, key, 'private-user');

	assert.equal(check(cache, privateTab, key), 'private-user', 'the window that cached it gets it back');
	assert.equal(check(cache, normalTab, key), undefined, 'a normal window must not see it');

	// And the other direction, which matters just as much: the normal profile's
	// identity must not leak into a private window.
	set(cache, normalTab, key, 'normal-user');
	assert.equal(check(cache, normalTab, key), 'normal-user');
	assert.equal(check(cache, privateTab, key), 'private-user', 'each context keeps its own answer');
});

test('the extension\'s own pages are their own partition, not a tab\'s', () => {
	const cache = new LRUCache(512);
	const key = 'GET|include|https://www.reddit.com/api/me.json';

	// A message from the options page arrives with no tab at all.
	set(cache, { tab: null }, key, 'from-options');
	assert.equal(check(cache, { tab: null }, key), 'from-options');
	assert.equal(check(cache, privateTab, key), undefined);
	assert.equal(check(cache, normalTab, key), undefined);

	assert.equal(cacheContext(null), 'extension');
	assert.equal(cacheContext(undefined), 'extension');
	assert.equal(cacheContext({}), 'extension');
});

test('deleting clears only the asking context, and clearing empties every one', () => {
	const cache = new LRUCache(512);
	const key = 'GET|include|https://www.reddit.com/api/me.json';

	set(cache, privateTab, key, 'private-user');
	set(cache, normalTab, key, 'normal-user');

	applyCacheOperation(cache, ['delete', key], normalTab);
	assert.equal(check(cache, normalTab, key), undefined, 'invalidate has to clear the entry it would have read');
	assert.equal(check(cache, privateTab, key), 'private-user', 'and only that one');

	// `clear` is a reader emptying the cache outright, so leaving another
	// window's copies behind would make that button a lie.
	applyCacheOperation(cache, ['clear'], normalTab);
	assert.equal(check(cache, privateTab, key), undefined);
});

test('an unknown operation is refused rather than silently ignored', () => {
	const cache = new LRUCache(512);
	assert.throws(() => applyCacheOperation(cache, ['nonsense', 'k'], normalTab), /Invalid XHRCache operation/);
});

test('the request half of the key separates credentials and method', () => {
	// The background composes the context; the foreground composes this half, so
	// what is asserted here is that two different requests to one URL cannot
	// collide once they arrive.
	const cache = new LRUCache(512);
	const url = 'https://www.reddit.com/r/pics/.json';

	set(cache, normalTab, `GET|include|${url}`, 'signed-in');
	set(cache, normalTab, `GET|omit|${url}`, 'signed-out');
	set(cache, normalTab, `POST|include|${url}`, 'posted');

	assert.equal(check(cache, normalTab, `GET|include|${url}`), 'signed-in');
	assert.equal(check(cache, normalTab, `GET|omit|${url}`), 'signed-out');
	assert.equal(check(cache, normalTab, `POST|include|${url}`), 'posted');
});
