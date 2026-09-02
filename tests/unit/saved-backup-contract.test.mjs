import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const {
	parseSavedPage,
	buildSavedUrl,
	mergeAndDedupe,
	buildExport,
	filterSavedItems,
	listSavedTags,
	mergeSavedRecords,
	normalizeSavedUsername,
	normalizeSavedTags,
	partitionSavedRecords,
	SAVED_CONTENT_SCHEMA_VERSION,
	UNASSIGNED_SAVED_ACCOUNT,
	loadSavedRecords,
	mergeSavedRecordsIntoStore,
	purgeSavedRecords,
	updateSavedRecordTags,
} = await loadFlowModule('lib/utils/savedBackup.js', 'saved-backup', {
	deps: ['lib/utils/featureStores.js'],
	stubs: {
		'../environment': 'export const canPersistFeatureData = () => true;',
		// A working store, keyed the way the real one is. A stub that swallowed
		// writes would make every assertion below vacuous.
		'../environment/foreground/featureDb': `
			const rows = new Map();
			const key = record => JSON.stringify([record.username, record.fullname]);
			export function readRecords(store, index, value) {
				const all = [...rows.values()];
				return Promise.resolve(index === 'username' ? all.filter(r => r.username === value) : all);
			}
			export function writeRecords(store, put = [], remove = []) {
				for (const k of remove) rows.delete(JSON.stringify(k));
				for (const record of put) rows.set(key(record), record);
				return Promise.resolve();
			}
		`,
	},
});

const SAVED_FIXTURE = {
	kind: 't3',
	fullname: 't3_fixture',
	id: 'fixture',
	subreddit: 'test',
	author: 'someone',
	permalink: '/r/test/comments/fixture/',
	createdUtc: 10,
	body: '',
	title: 'A saved post',
	url: 'https://example.com/',
	score: 1,
};

test('parseSavedPage extracts t1 and t3 items, falling back to selftext for posts', () => {
	const page = parseSavedPage({
		data: {
			children: [
				{ kind: 't1', data: { name: 't1_abc', id: 'abc', subreddit: 's', author: 'a', permalink: '/p/c/', created_utc: 100, body: 'cb', score: 5 } },
				{ kind: 't3', data: { name: 't3_def', id: 'def', subreddit: 's', author: 'b', permalink: '/p/', created_utc: 200, title: 'T', selftext: 'St', url: 'https://x', score: 7 } },
				{ kind: 'more', data: { count: 1 } },
			],
			after: 't1_xyz',
		},
	});
	assert.equal(page.items.length, 2);
	assert.equal(page.items[0].body, 'cb');
	assert.equal(page.items[1].body, 'St', 'selftext used when no body');
	assert.equal(page.items[1].title, 'T');
	assert.equal(page.after, 't1_xyz');
});

test('parseSavedPage returns empty + null on malformed input', () => {
	assert.deepEqual(parseSavedPage(null), { items: [], after: null });
	assert.deepEqual(parseSavedPage({}), { items: [], after: null });
	assert.deepEqual(parseSavedPage({ data: { children: 'nope' } }), { items: [], after: null });
});

test('buildSavedUrl encodes username, clamps limit, appends after', () => {
	assert.equal(
		buildSavedUrl('alice', null, 100),
		'https://old.reddit.com/user/alice/saved.json?limit=100&raw_json=1',
	);
	const u = buildSavedUrl('u/With_Name/', 't3_xyz', 200);
	assert.match(u, /\/user\/with_name\//);
	assert.match(u, /limit=100/, 'clamped to max 100');
	assert.match(u, /after=t3_xyz/);
});

test('mergeAndDedupe preserves order, drops duplicates by fullname', () => {
	const a = [{ fullname: 't1_a', kind: 't1', id: '', subreddit: '', author: '', permalink: '', createdUtc: 0, body: '', title: '', url: '', score: 0 }];
	const b = [
		{ fullname: 't1_a', kind: 't1', id: '', subreddit: '', author: '', permalink: '', createdUtc: 0, body: '', title: '', url: '', score: 0 },
		{ fullname: 't1_b', kind: 't1', id: '', subreddit: '', author: '', permalink: '', createdUtc: 0, body: '', title: '', url: '', score: 0 },
	];
	const merged = mergeAndDedupe(a, b);
	assert.deepEqual(merged.map(x => x.fullname), ['t1_a', 't1_b']);
});

test('saved account names are case-insensitive and cannot collide with the migration partition', () => {
	assert.equal(normalizeSavedUsername(' u/Alice_Example/ '), 'alice_example');
	assert.equal(normalizeSavedUsername('not a reddit user'), '');
	assert.equal(normalizeSavedUsername(UNASSIGNED_SAVED_ACCOUNT), '');
});

test('buildExport stamps schema v2 and includes only the selected account', () => {
	const exp = buildExport('ALICE', [
		{ username: 'alice', fullname: 't1_a', kind: 't1', id: 'a', subreddit: '', author: '', permalink: '', createdUtc: 0, body: '', title: '', url: '', score: 0, tags: [], savedAt: 1, lastSeenAt: 1 },
		{ username: 'bob', fullname: 't1_b', kind: 't1', id: 'b', subreddit: '', author: '', permalink: '', createdUtc: 0, body: '', title: '', url: '', score: 0, tags: [], savedAt: 1, lastSeenAt: 1 },
	]);
	assert.equal(exp.username, 'alice');
	assert.equal(exp.count, 1);
	assert.equal(exp.schemaVersion, 2);
	assert.deepEqual(exp.items.map(item => item.fullname), ['t1_a']);
	assert.ok(exp.exportedAt > 0);
});

test('saved records preserve local tags across a sync merge', () => {
	const existing = [{
		username: 'alice',
		fullname: 't1_a',
		kind: 't1',
		id: 'a',
		subreddit: 's',
		author: 'alice',
		permalink: '/a',
		createdUtc: 10,
		body: 'old',
		title: '',
		url: '',
		score: 1,
		tags: ['Keep'],
		savedAt: 7,
		lastSeenAt: 8,
	}];
	const incoming = [{
		fullname: 't1_a',
		kind: 't1',
		id: 'a',
		subreddit: 's',
		author: 'alice',
		permalink: '/a',
		createdUtc: 10,
		body: 'new',
		title: '',
		url: '',
		score: 2,
	}];
	const merged = mergeSavedRecords('Alice', existing, incoming, 20);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].username, 'alice');
	assert.equal(merged[0].body, 'new');
	assert.deepEqual(merged[0].tags, ['Keep']);
	assert.equal(merged[0].savedAt, 7);
	assert.equal(merged[0].lastSeenAt, 20);
});

test('saved tag normalisation is bounded, deduplicated, and case-insensitive', () => {
	assert.deepEqual(normalizeSavedTags([' work ', 'Work', '', 'read later']), ['work', 'read later']);
});

test('saved search covers content and exact tag filters', () => {
	const alice = mergeSavedRecords('alice', [], [
		{ fullname: 't3_a', kind: 't3', id: 'a', subreddit: 'books', author: 'alice', permalink: '/a', createdUtc: 2, body: 'A novel', title: 'Reading list', url: '', score: 1 },
		{ fullname: 't1_b', kind: 't1', id: 'b', subreddit: 'games', author: 'bob', permalink: '/b', createdUtc: 1, body: 'Speedrun notes', title: '', url: '', score: 2 },
	], 30).map((item, index) => ({ ...item, tags: index ? ['later'] : ['keep'] }));
	const bob = mergeSavedRecords('bob', [], [
		{ fullname: 't3_a', kind: 't3', id: 'a', subreddit: 'private', author: 'bob', permalink: '/private', createdUtc: 3, body: 'Bob only', title: '', url: '', score: 3 },
	], 31).map(item => ({ ...item, tags: ['secret'] }));
	const mixed = [...alice, ...bob];
	assert.deepEqual(filterSavedItems(mixed, 'alice', 'novel', '').map(item => item.fullname), ['t3_a']);
	assert.deepEqual(filterSavedItems(mixed, 'alice', '', 'later').map(item => item.fullname), ['t1_b']);
	assert.deepEqual(filterSavedItems(mixed, 'alice', 'bob only', ''), []);
	assert.deepEqual(filterSavedItems(mixed, 'alice', '', '__untagged__'), []);
	assert.deepEqual(listSavedTags(mixed, 'alice'), ['keep', 'later']);
	assert.deepEqual(listSavedTags(mixed, 'bob'), ['secret']);
});

test('A then B then A partitions identical fullnames without cross-account mutation', () => {
	const shared = account => ({
		fullname: 't3_shared',
		kind: 't3',
		id: 'shared',
		subreddit: account,
		author: account,
		permalink: `/${account}`,
		createdUtc: 1,
		body: `${account} body`,
		title: `${account} title`,
		url: '',
		score: 1,
	});
	const alice = mergeSavedRecords('Alice', [], [shared('alice')], 10)
		.map(item => ({ ...item, tags: ['alice-tag'] }));
	const bob = mergeSavedRecords('Bob', alice, [shared('bob')], 20)
		.map(item => ({ ...item, tags: ['bob-tag'] }));
	const all = [...alice, ...bob];

	assert.deepEqual(partitionSavedRecords(all, 'alice').map(item => [item.title, item.tags]), [['alice title', ['alice-tag']]]);
	assert.deepEqual(partitionSavedRecords(all, 'bob').map(item => [item.title, item.tags]), [['bob title', ['bob-tag']]]);
	assert.deepEqual(partitionSavedRecords(all, 'Alice').map(item => item.tags), [['alice-tag']]);
});

test('savedBackup module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as savedBackup \} from '\.\/savedBackup';/);
	assert.match(index, /^\s*savedBackup,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/savedBackup.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/savedBackup'/);
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /buildSavedUrl\(/);
	assert.match(mod, /loadSavedRecords\(/);
	assert.match(mod, /mergeSavedRecordsIntoStore\(/);
	assert.match(mod, /updateSavedRecordTags\(/);
	assert.match(mod, /purgeSavedRecords\(/);
	assert.match(mod, /add\.type = 'submit'/);
	assert.match(mod, /rsm-savedBackup-panel/);
	for (const opt of ['pageLimit', 'maxPages']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('the account key and the v1 recovery path survived the move to the extension database', () => {
	// The upgrade used to live in an `onupgradeneeded` handler inside this
	// helper. It is now a one-time copy out of reddit.com's storage, so the
	// facts it depended on are asserted where they moved to.
	const stores = fs.readFileSync(path.join(repoRoot, 'lib/utils/featureStores.js'), 'utf8');
	assert.equal(SAVED_CONTENT_SCHEMA_VERSION, 2);
	assert.match(stores, /keyPath: \['username', 'fullname'\]/);
	assert.match(stores, /storeName: 'accountItems', altStoreName: 'items'/);
	assert.match(stores, /legacyDefaults: \{ username: UNASSIGNED_SAVED_ACCOUNT \}/);
	assert.match(stores, /accountScoped: true/);

	const migration = fs.readFileSync(path.join(repoRoot, 'lib/environment/foreground/featureDbMigration.js'), 'utf8');
	assert.match(migration, /altStoreName/);
	assert.match(migration, /legacyDefaults/);

	// A whole-store purge across accounts has no button anywhere: the workspace
	// purges what is on screen, and saved content is filtered by account first.
	const workspace = fs.readFileSync(path.join(repoRoot, 'lib/options/dataWorkspace.js'), 'utf8');
	assert.match(workspace, /accountOf: record => text\(record\.username\)/);
	assert.match(workspace, /if \(set\.accountOf && account !== ALL_ACCOUNTS && set\.accountOf\(record\) !== account\) return false;/);
});

test('every stored operation is scoped to one account', async () => {
	const alice = [{ ...SAVED_FIXTURE, fullname: 't3_alice' }];
	const bob = [{ ...SAVED_FIXTURE, fullname: 't3_bob' }];
	await mergeSavedRecordsIntoStore('alice', alice, 100);
	await mergeSavedRecordsIntoStore('bob', bob, 100);

	assert.deepEqual((await loadSavedRecords('alice')).map(r => r.fullname), ['t3_alice']);
	assert.deepEqual((await loadSavedRecords('bob')).map(r => r.fullname), ['t3_bob']);

	// One account's tag never lands on the other's copy of the same item.
	await mergeSavedRecordsIntoStore('bob', alice, 100);
	await updateSavedRecordTags('bob', 't3_alice', ['bob-only']);
	assert.deepEqual((await loadSavedRecords('alice'))[0].tags, []);
	assert.deepEqual((await loadSavedRecords('bob')).find(r => r.fullname === 't3_alice').tags, ['bob-only']);

	// And purging one account leaves the other's records where they were.
	assert.equal(await purgeSavedRecords('alice'), 1);
	assert.deepEqual(await loadSavedRecords('alice'), []);
	assert.equal((await loadSavedRecords('bob')).length, 2);
	await purgeSavedRecords('bob');
});

test('saved manager styles are shipped', () => {
	const scss = fs.readFileSync(path.join(repoRoot, 'lib/css/modules/_savedBackup.scss'), 'utf8');
	const res = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(scss, /\.rsm-savedBackup-panel/);
	assert.match(scss, /\.rsm-savedBackup-tag-form/);
	assert.match(res, /@use 'modules\/savedBackup'/);
});
