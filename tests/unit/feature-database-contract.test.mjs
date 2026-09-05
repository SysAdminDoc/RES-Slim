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

async function loadMigration({ databases, marker = {}, privateWindow = false, withDatabaseList = true }) {
	// The stubs read these lazily, inside their function bodies: a stub that
	// captured them at module scope would hold the previous test's arrays.
	globalThis.__migrationWrites = [];
	globalThis.__migrationMarker = { value: marker };
	const db = fakeIndexedDb(databases);
	if (!withDatabaseList) delete db.databases;
	globalThis.indexedDB = db;

	const mod = await loadFlowModule('lib/environment/foreground/featureDbMigration.js', `feature-db-migration-${Math.random().toString(36).slice(2)}`, {
		deps: ['lib/utils/featureStores.js'],
		stubs: {
			'../../utils/featureStores': 'export * from "./featureStores.mjs";',
			'./featureDb': `
				export function writeRecords(store, put) { globalThis.__migrationWrites.push([store, put]); return Promise.resolve(); }
			`,
			'./privateBrowsing': `export const isPrivateBrowsing = () => ${privateWindow ? 'true' : 'false'};`,
			'./storage': `
				export function wrap() {
					return {
						get: () => Promise.resolve(globalThis.__migrationMarker.value),
						set: value => { globalThis.__migrationMarker.value = value; return Promise.resolve(); },
					};
				}
			`,
		},
	});
	return { mod, written: globalThis.__migrationWrites, stored: globalThis.__migrationMarker, deleted: db.deleted };
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
