// The local data sets moved out of reddit.com's storage and into the
// extension's. Two things have to hold for that to be safe: the one-time copy
// must not lose or mis-attribute a record, and it must not mark itself done
// when it did not run.
//
// The copy is the only part of this that touches user data it cannot get back,
// so it is executed here against a fake IndexedDB rather than pattern-matched.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadFlowModule, repoRoot } from './helpers/loadFlowModule.mjs';

// Enough of IndexedDB for an open-and-read: named databases, named stores,
// `getAll`, and the upgrade callback that tells the caller it just created one.
function fakeIndexedDb(databases) {
	const deleted = [];
	return {
		deleted,
		databases: () => Promise.resolve(Object.keys(databases).map(name => ({ name }))),
		deleteDatabase(name) {
			deleted.push(name);
			delete databases[name];
			const request = {};
			queueMicrotask(() => request.onsuccess && request.onsuccess());
			return request;
		},
		open(name) {
			const request = {};
			const fresh = !databases[name];
			if (fresh) databases[name] = {};
			const stores = databases[name];
			request.result = {
				close() {},
				objectStoreNames: { contains: store => Object.hasOwn(stores, store) },
				transaction: () => ({
					objectStore: store => ({
						getAll() {
							const read = {};
							queueMicrotask(() => { read.result = stores[store].slice(); if (read.onsuccess) read.onsuccess(); });
							return read;
						},
					}),
				}),
			};
			queueMicrotask(() => {
				if (fresh && request.onupgradeneeded) request.onupgradeneeded();
				if (request.onsuccess) request.onsuccess();
			});
			return request;
		},
	};
}

async function loadMigration({
	databases,
	marker = {},
	progress = {},
	privateWindow = false,
	withDatabaseList = true,
	// A stand-in for `chrome.runtime.sendMessage`'s payload limit: the bridge
	// serialises the whole thing, and the failure this file is about is one
	// message that was too big to send.
	maxPayloadBytes = Infinity,
}) {
	// The stubs read these lazily, inside their function bodies: a stub that
	// captured them at module scope would hold the previous test's arrays.
	globalThis.__migrationWrites = [];
	globalThis.__migrationStores = { 'RESmodules.featureData.migrated': marker, 'RESmodules.featureData.migrationProgress': progress };
	globalThis.__migrationSets = [];
	globalThis.__migrationLimit = maxPayloadBytes;
	const db = fakeIndexedDb(databases);
	if (!withDatabaseList) delete db.databases;
	globalThis.indexedDB = db;

	const mod = await loadFlowModule('lib/environment/foreground/featureDbMigration.js', `feature-db-migration-${Math.random().toString(36).slice(2)}`, {
		deps: ['lib/utils/featureStores.js'],
		stubs: {
			'../../utils/featureStores': 'export * from "./featureStores.mjs";',
			'./featureDb': `
				export function writeRecords(store, put) {
					const size = JSON.stringify(put).length;
					if (size > globalThis.__migrationLimit) {
						return Promise.reject(new Error('Message length exceeded maximum allowed length'));
					}
					globalThis.__migrationWrites.push([store, put]);
					return Promise.resolve();
				}
			`,
			'./privateBrowsing': `export const isPrivateBrowsing = () => ${privateWindow ? 'true' : 'false'};`,
			// Keyed by name. One shared store would let the progress writes land on
			// the marker and the marker's final write hide them, which is exactly the
			// kind of accident that makes a resume test prove nothing.
			'./storage': `
				export function wrap(key) {
					return {
						get: () => Promise.resolve(globalThis.__migrationStores[key]),
						set: value => {
							globalThis.__migrationSets.push([key, JSON.parse(JSON.stringify(value))]);
							globalThis.__migrationStores[key] = value;
							return Promise.resolve();
						},
					};
				}
			`,
		},
	});
	return {
		mod,
		written: globalThis.__migrationWrites,
		stored: { get value() { return globalThis.__migrationStores['RESmodules.featureData.migrated']; } },
		progress: { get value() { return globalThis.__migrationStores['RESmodules.featureData.migrationProgress']; } },
		sets: globalThis.__migrationSets,
		deleted: db.deleted,
		setLimit: bytes => { globalThis.__migrationLimit = bytes; },
	};
}

test('records are copied across and the marker records how many', async () => {
	const { mod, written, stored } = await loadMigration({
		databases: {
			'rsm-voteHistory': { votes: [{ id: 'a' }, { id: 'b' }] },
			'rsm-mediaManifest': { entries: [{ id: 'm' }] },
		},
	});
	const moved = await mod.migrateLegacyFeatureStores();

	assert.deepEqual(moved, { voteHistory: 2, mediaManifest: 1 });
	assert.deepEqual(written, [
		['voteHistory', [{ id: 'a' }, { id: 'b' }]],
		['mediaManifest', [{ id: 'm' }]],
	]);
	// A set with no old database still gets a marker, so the check does not
	// repeat on every page load for the life of the profile.
	assert.deepEqual(stored.value, { voteHistory: 2, mediaManifest: 1, savedContent: 0, subredditEmotes: 0 });
});

test('a set that was already copied is left alone', async () => {
	const { mod, written } = await loadMigration({
		databases: { 'rsm-voteHistory': { votes: [{ id: 'a' }, { id: 'b' }] } },
		marker: { voteHistory: 2 },
	});
	await mod.migrateLegacyFeatureStores();
	assert.deepEqual(written, []);
});

test('saved content from the v1 store is stamped unassigned rather than given to whoever is signed in', async () => {
	const { mod, written } = await loadMigration({
		databases: { 'rsm-savedContent': { items: [{ fullname: 't3_old', title: 'Before accounts' }] } },
	});
	await mod.migrateLegacyFeatureStores();

	const [[store, records]] = written.filter(([id]) => id === 'savedContent');
	assert.equal(store, 'savedContent');
	assert.deepEqual(records, [{ username: '<unassigned>', fullname: 't3_old', title: 'Before accounts' }]);
});

test('the v2 store wins over the v1 one when a profile has both', async () => {
	const { mod, written } = await loadMigration({
		databases: {
			'rsm-savedContent': {
				items: [{ fullname: 't3_old' }],
				accountItems: [{ username: 'alice', fullname: 't3_new' }],
			},
		},
	});
	await mod.migrateLegacyFeatureStores();
	const [[, records]] = written.filter(([id]) => id === 'savedContent');
	assert.deepEqual(records, [{ username: 'alice', fullname: 't3_new' }]);
});

test('a private window copies nothing and writes no marker', async () => {
	const { mod, written, stored } = await loadMigration({
		databases: { 'rsm-voteHistory': { votes: [{ id: 'a' }] } },
		privateWindow: true,
	});
	await mod.migrateLegacyFeatureStores();
	assert.deepEqual(written, []);
	// Otherwise the private window's empty view of reddit.com's storage would
	// mark the real profile's data as already migrated.
	assert.deepEqual(stored.value, {});
});

test('without databases() the check opens, finds nothing, and removes what it created', async () => {
	const { mod, written, deleted } = await loadMigration({ databases: {}, withDatabaseList: false });
	await mod.migrateLegacyFeatureStores();
	assert.deepEqual(written, []);
	assert.deepEqual(deleted.sort(), ['rsm-mediaManifest', 'rsm-savedContent', 'rsm-subredditEmotes', 'rsm-voteHistory']);
});

test('the background page is the only thing that opens the extension database', () => {
	const background = fs.readFileSync(path.join(repoRoot, 'lib/environment/background/featureDb.js'), 'utf8');
	const foreground = fs.readFileSync(path.join(repoRoot, 'lib/environment/foreground/featureDb.js'), 'utf8');
	assert.match(background, /indexedDB\.open\(FEATURE_DB_NAME, FEATURE_DB_VERSION\)/);
	assert.doesNotMatch(foreground, /indexedDB/);

	// Every message the foreground sends has a handler, and every handler is
	// reachable. A typo either way is a silent no-op that returns undefined.
	const sent = [...foreground.matchAll(/sendMessage\('(featureDb-[a-z]+)'/g)].map(m => m[1]);
	const handled = [...background.matchAll(/addListener\('(featureDb-[a-z]+)'/g)].map(m => m[1]);
	assert.deepEqual([...new Set(sent)].sort(), [...new Set(handled)].sort());

	// The background is loaded by the background entry, or none of it runs.
	const entry = fs.readFileSync(path.join(repoRoot, 'lib/background.entry.js'), 'utf8');
	assert.match(entry, /import '\.\/environment\/background\/featureDb';/);
});

test('a put and a delete for the same store go through one transaction', () => {
	const background = fs.readFileSync(path.join(repoRoot, 'lib/environment/background/featureDb.js'), 'utf8');
	const write = background.slice(background.indexOf('const writeFeatureRecords'), background.indexOf('export { writeFeatureRecords }'));
	assert.match(write, /keyedMutex\(/, 'writes to one store are serialised');
	assert.match(write, /transact\(storeId, 'readwrite', \(store, done\) => \{[\s\S]*store\.delete[\s\S]*store\.put/);
});

// Rolling back to an earlier build is the documented way to recover from a bad
// one — there is no automatic update here, and the README's only upgrade path is
// pull, rebuild, reload. So an older build meeting a database a newer one wrote
// is an ordinary thing to do, and IndexedDB answers it with a bare `VersionError`.
// Every feature store rejects at once, so tags, vote history, saved content, the
// media manifest and visited posts go blank together, which looks exactly like
// the data having been lost.
test('an older build meeting a newer database says so, instead of failing like data loss', async () => {
	const stores = await loadFlowModule('lib/utils/featureStores.js', 'feature-db-version-error');
	const { describeOpenFailure } = stores;

	const versionError = new Error('The requested version is less than the existing version.');
	versionError.name = 'VersionError';
	const described = describeOpenFailure(versionError);

	// The version gap, named, so the reader knows which way round it is.
	assert.match(described.message, /older than the local data/);
	assert.match(described.message, /version 1\b/, 'the message has to name the version this build is at');
	assert.match(described.message, /newer build/);
	// And the reassurance, because the failure mode is indistinguishable from loss.
	assert.match(described.message, /have been lost/);
	assert.match(described.message, /Pull and rebuild/, 'a message with no way out of it is only half a message');

	// Everything else is passed through untouched. A quota failure, a blocked
	// upgrade and a corrupt file are different problems and must not be dressed up
	// as a version mismatch.
	const other = new Error('Internal error opening backing store');
	other.name = 'UnknownError';
	assert.equal(describeOpenFailure(other), other, 'an unrelated failure must not be rewritten');
	assert.match(describeOpenFailure(null).message, /Could not open the feature database/);
});

test('the open path reports through that description rather than a bare string', () => {
	// The message is only worth writing if the thing that fails uses it.
	const source = fs.readFileSync(path.join(repoRoot, 'lib', 'environment', 'background', 'featureDb.js'), 'utf8');
	assert.match(source, /request\.onerror = \(\) => reject\(describeOpenFailure\(request\.error\)\);/);
});

// One message per store was never going to hold a vote history. The bridge is
// `chrome.runtime.sendMessage`, which serialises the whole payload, and a
// fifty-thousand record log with 240-character snippets does not fit in one --
// so the copy threw, the marker was deliberately left unset, and the next Reddit
// page load read the whole store and posted the whole thing again. For the life
// of the profile, with nobody told.

function bulkVotes(count) {
	return Array.from({ length: count }, (_, index) => ({
		id: `v${index}`,
		timestamp: 1_700_000_000_000 + index,
		snippet: 'x'.repeat(240),
	}));
}

test('a store too big for one message is copied in batches', async () => {
	const records = bulkVotes(60_000);
	// Comfortably smaller than the whole store, comfortably larger than a batch.
	const { mod, written, stored, progress } = await loadMigration({
		databases: { 'rsm-voteHistory': { votes: records } },
		maxPayloadBytes: 8 * 1024 * 1024,
	});

	const moved = await mod.migrateLegacyFeatureStores();

	assert.equal(moved.voteHistory, 60_000, 'the copy did not finish');
	const voteWrites = written.filter(([store]) => store === 'voteHistory');
	assert.ok(voteWrites.length > 1, 'the whole store went in one message again');
	assert.equal(voteWrites.reduce((total, [, put]) => total + put.length, 0), 60_000, 'records were lost between batches');

	// Every id, once, in order.
	const seen = voteWrites.flatMap(([, put]) => put.map(record => record.id));
	assert.equal(new Set(seen).size, 60_000, 'a record was copied twice');
	assert.equal(seen[0], 'v0');
	assert.equal(seen[seen.length - 1], 'v59999');

	assert.equal(stored.value.voteHistory, 60_000, 'the marker was not written');
	assert.deepEqual(progress.value, {}, 'a finished store left half-done state behind');
});

test('a copy that fails part way resumes rather than starting again', async () => {
	const records = bulkVotes(10_000);
	const harness = await loadMigration({
		databases: { 'rsm-voteHistory': { votes: records } },
		maxPayloadBytes: 8 * 1024 * 1024,
	});

	// Two batches land, then the bridge starts refusing everything.
	let landed = 0;
	globalThis.__migrationLimit = Infinity;
	const realWrites = globalThis.__migrationWrites;
	globalThis.__migrationWrites = {
		push(entry) {
			landed += 1;
			if (landed > 2) throw new Error('Message length exceeded maximum allowed length');
			realWrites.push(entry);
		},
	};
	try {
		await harness.mod.migrateLegacyFeatureStores();
	} finally {
		globalThis.__migrationWrites = realWrites;
	}

	const copiedFirstTime = realWrites.reduce((total, [, put]) => total + put.length, 0);
	assert.ok(copiedFirstTime > 0 && copiedFirstTime < 10_000, `the first attempt copied ${copiedFirstTime}`);
	assert.equal(harness.progress.value.voteHistory.copied, copiedFirstTime, 'the progress was not recorded');
	assert.equal(harness.progress.value.voteHistory.failures, 1);
	assert.equal(harness.stored.value.voteHistory, undefined, 'an unfinished copy must not be marked done');

	// The next page load: the bridge works again.
	const second = await loadMigration({
		databases: { 'rsm-voteHistory': { votes: records } },
		marker: harness.stored.value,
		progress: harness.progress.value,
		maxPayloadBytes: 8 * 1024 * 1024,
	});
	const moved = await second.mod.migrateLegacyFeatureStores();

	const copiedAgain = second.written.reduce((total, [, put]) => total + put.length, 0);
	assert.equal(copiedAgain, 10_000 - copiedFirstTime, 'the resumed copy started from nothing');
	assert.equal(moved.voteHistory, 10_000 - copiedFirstTime);
	assert.equal(second.stored.value.voteHistory, 10_000);

	// And between them, every record went across exactly once.
	const all = [...realWrites, ...second.written].flatMap(([, put]) => put.map(record => record.id));
	assert.equal(new Set(all).size, 10_000);
});

test('three failures in a row stop being a secret', async () => {
	// Not a reason to give up -- the records are still in the old database -- but
	// a reader whose vote history did not appear is entitled to find out why.
	const reported = [];
	let progress = {};
	for (const attempt of [1, 2, 3, 4]) {
		// eslint-disable-next-line no-await-in-loop
		const harness = await loadMigration({
			databases: { 'rsm-voteHistory': { votes: bulkVotes(5) } },
			progress,
			maxPayloadBytes: 1,
		});
		// eslint-disable-next-line no-await-in-loop
		await harness.mod.migrateLegacyFeatureStores((storeId, attempts, error) => {
			reported.push({ attempt, storeId, attempts, message: String(error && error.message) });
		});
		progress = harness.progress.value;
		assert.equal(progress.voteHistory.failures, attempt, `attempt ${attempt} did not count`);
	}

	assert.equal(reported.length, 2, `reported on attempts ${reported.map(r => r.attempt).join(', ')}`);
	assert.equal(reported[0].attempt, 3, 'the first report came too early or too late');
	assert.equal(reported[0].storeId, 'voteHistory');
	assert.equal(reported[0].attempts, 3);
	assert.match(reported[0].message, /Message length/);
});

test('a reporter that throws does not stop the other stores', async () => {
	const harness = await loadMigration({
		databases: { 'rsm-voteHistory': { votes: bulkVotes(2) }, 'rsm-mediaManifest': { entries: [{ id: 'm' }] } },
		progress: { voteHistory: { copied: 0, failures: 2 } },
		maxPayloadBytes: 1,
	});

	await harness.mod.migrateLegacyFeatureStores(() => { throw new Error('the log is broken too'); });

	// The media set has one record and a one-byte limit, so it fails as well --
	// what matters is that it was still tried after the reporter threw.
	assert.equal(harness.progress.value.voteHistory.failures, 3);
	assert.equal(harness.progress.value.mediaManifest.failures, 1);
	// And the stores with no old database still get their marker.
	assert.equal(harness.stored.value.savedContent, 0);
});
