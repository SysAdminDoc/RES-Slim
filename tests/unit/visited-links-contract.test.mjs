// The local visited-link set that replaced the `history` permission.
//
// `showImages` used to call `chrome.history.addUrl()` when you expanded a media
// link, purely so the browser would repaint it in the `:visited` colour. That one
// cosmetic behaviour was the sole reason both manifests declared `history` —
// "Read and change your browsing history", the scariest line in the Chrome
// install prompt.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { codeOnly, loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));

const {
	DEFAULT_EXPIRE_DAYS,
	MAX_ENTRIES,
	expiredKeys,
	isVisited,
	markVisited,
	normalizeUrl,
	overflowKeys,
	pruneVisited,
} = await loadFlowModule('lib/utils/visitedLinks.js', 'visited-links');

const DAY = 86400000;

test('neither manifest asks for the history permission', () => {
	for (const manifest of ['chrome/manifest.json', 'firefox/manifest.json']) {
		const { permissions } = readJson(manifest);
		assert.ok(Array.isArray(permissions), `${manifest} should declare permissions`);
		assert.ok(
			!permissions.includes('history'),
			`${manifest} still asks for "history" — the whole point of the local set is that it does not`,
		);
	}
});

test('no code reaches for chrome.history any more', () => {
	// A leftover call would now fail silently at runtime, which is exactly the
	// breakage a manifest-only check misses.
	//
	// Stripped before matching, and the stripper is proven to have run below. Every
	// file that explains *why* the permission went away names `chrome.history` in
	// prose, so an unstripped scan reports its own documentation as a violation —
	// and on a CRLF checkout a naive stripper is a silent no-op, which would make
	// this assertion pass for the wrong reason.
	const offenders = [];
	const documented = [];

	const walk = dir => {
		for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
			const rel = `${dir}/${entry.name}`;
			if (entry.isDirectory()) { walk(rel); continue; }
			if (!entry.name.endsWith('.js')) continue;

			const raw = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
			if (!/chrome\.history\b/.test(raw)) continue;

			documented.push(rel);
			if (/chrome\.history\b/.test(codeOnly(raw))) offenders.push(rel);
		}
	};
	walk('lib');

	assert.ok(documented.length > 0, 'sanity: some file should still discuss chrome.history in prose, or this test proves nothing');
	assert.deepEqual(offenders, [], 'these files call chrome.history in code, not just in a comment');
});

test('normalizeUrl collapses the variants that would otherwise miss', () => {
	const canonical = normalizeUrl('https://i.imgur.com/abc123.png');

	assert.equal(normalizeUrl('http://i.imgur.com/abc123.png'), canonical, 'scheme must not split the entry');
	assert.equal(normalizeUrl('https://www.i.imgur.com/abc123.png'), canonical, 'a www. prefix must not split the entry');
	assert.equal(normalizeUrl('https://i.imgur.com/abc123.png#top'), canonical, 'a fragment must not split the entry');
	assert.equal(normalizeUrl('https://i.imgur.com/abc123.png?utm_source=x'), canonical, 'rotating tracking params must not split the entry');
	assert.equal(normalizeUrl('https://I.IMGUR.COM/abc123.png'), canonical, 'host case must not split the entry');
});

test('normalizeUrl keeps distinct media distinct', () => {
	assert.notEqual(normalizeUrl('https://i.imgur.com/a.png'), normalizeUrl('https://i.imgur.com/b.png'));
	// Path case is significant — imgur ids are case-sensitive, so lowercasing the
	// path would collide two different images.
	assert.notEqual(normalizeUrl('https://i.imgur.com/aBc.png'), normalizeUrl('https://i.imgur.com/abc.png'));
});

test('normalizeUrl refuses anything that is not http(s)', () => {
	for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'chrome-extension://abc/x.html', '', null, undefined, 42]) {
		assert.equal(normalizeUrl(bad), null, `${String(bad)} must not become a stored key`);
	}
});

test('an unusable URL is not recorded and never reads back as visited', () => {
	const map = markVisited({}, 'javascript:alert(1)', Date.now());

	assert.deepEqual(map, {}, 'nothing should be stored');
	assert.equal(isVisited(map, 'javascript:alert(1)'), false);
});

test('a marked URL reads back as visited through any of its variants', () => {
	const now = Date.now();
	const map = markVisited({}, 'https://i.imgur.com/abc123.png?utm_source=reddit', now);

	assert.equal(isVisited(map, 'https://i.imgur.com/abc123.png'), true);
	assert.equal(isVisited(map, 'http://www.i.imgur.com/abc123.png#x'), true);
	assert.equal(isVisited(map, 'https://i.imgur.com/other.png'), false);
});

test('entries older than the window expire, and fresh ones do not', () => {
	const now = Date.now();
	const map = {
		fresh: now - DAY,
		edge: now - (DEFAULT_EXPIRE_DAYS - 1) * DAY,
		stale: now - (DEFAULT_EXPIRE_DAYS + 1) * DAY,
	};

	const expired = expiredKeys(map, DEFAULT_EXPIRE_DAYS, now);

	assert.ok(expired.includes('stale'));
	assert.ok(!expired.includes('fresh'));
	assert.ok(!expired.includes('edge'));
});

test('a corrupt or future timestamp expires rather than living forever', () => {
	const now = Date.now();
	const map = {
		future: now + 10 * DAY,
		notANumber: 'yesterday',
		nan: NaN,
		missing: undefined,
	};

	assert.deepEqual(
		expiredKeys(map, DEFAULT_EXPIRE_DAYS, now).sort(),
		['future', 'missing', 'nan', 'notANumber'],
		'an entry with a timestamp that is not a sane past number is corrupt, not fresh',
	);
});

test('the set is capped, evicting oldest first and deterministically', () => {
	const now = Date.now();
	const map = {};
	for (let i = 0; i < MAX_ENTRIES + 10; i++) map[`host/path${i}`] = now - i * 1000;

	const overflow = overflowKeys(map);

	assert.equal(overflow.length, 10, 'exactly the excess should be evicted');
	// The oldest are the highest indices, since each is a second older.
	for (const key of overflow) {
		const index = Number(key.replace('host/path', ''));
		assert.ok(index >= MAX_ENTRIES, `${key} is not among the oldest and should have been kept`);
	}

	assert.deepEqual(overflowKeys(map), overflow, 'eviction must be deterministic across calls');
});

test('a set at or under the cap evicts nothing', () => {
	const now = Date.now();
	const map = {};
	for (let i = 0; i < MAX_ENTRIES; i++) map[`host/path${i}`] = now - i;

	assert.deepEqual(overflowKeys(map), []);
});

test('pruneVisited reports every removed key and returns the surviving map', () => {
	const now = Date.now();
	const map = { keep: now - DAY, drop: now - (DEFAULT_EXPIRE_DAYS + 5) * DAY };

	const { map: survivors, removed } = pruneVisited(map, DEFAULT_EXPIRE_DAYS, now);

	assert.deepEqual(Object.keys(survivors), ['keep']);
	assert.deepEqual(removed, ['drop'], 'the caller deletes by key list, so the keys must come back');
});

test('an invalid expiry window falls back to the default instead of dropping everything', () => {
	const now = Date.now();
	const map = { keep: now - DAY };

	for (const bad of [0, -5, NaN, undefined, 'ninety']) {
		assert.deepEqual(expiredKeys(map, bad, now), [], `expiry window ${String(bad)} must not expire a day-old entry`);
	}
});

// The query is not dropped wholesale. It was, and that collapsed every
// `youtube.com/watch?v=<id>` into one key — so expanding a single video marked
// every YouTube link on the site as visited. showImages ships a YouTube handler,
// so this was reachable, not theoretical.
test('params that identify the resource are kept, so distinct media stay distinct', () => {
	const a = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
	const b = 'https://www.youtube.com/watch?v=BBBBBBBBBBB';

	assert.notEqual(normalizeUrl(a), normalizeUrl(b), 'two different videos must not share a key');
	assert.equal(isVisited(markVisited({}, a, Date.now()), b), false, 'expanding one video must not mark another');

	// Same shape for any query-keyed host.
	assert.notEqual(normalizeUrl('https://www.google.com/search?q=cats'), normalizeUrl('https://www.google.com/search?q=dogs'));
});

test('volatile params are still stripped, so one image matches itself', () => {
	const image = 'https://i.imgur.com/abc123.png';
	const map = markVisited({}, image, Date.now());

	for (const variant of [
		`${image}?utm_source=reddit&utm_medium=web`,
		`${image}?s=abcdef0123456789`,
		`${image}?width=320&height=240&format=pjpg&auto=webp`,
		`${image}?fbclid=xyz`,
		`${image}#top`,
	]) {
		assert.equal(isVisited(map, variant), true, `${variant} should match the same image`);
	}
});

test('param order does not split one resource into two entries', () => {
	assert.equal(
		normalizeUrl('https://example.com/a?b=2&a=1'),
		normalizeUrl('https://example.com/a?a=1&b=2'),
		'the key must be order-independent, or the same URL stores twice',
	);
});

test('a stripped-to-nothing query leaves no trailing separator', () => {
	assert.equal(normalizeUrl('https://i.imgur.com/abc.png?utm_source=x'), 'i.imgur.com/abc.png');
});
