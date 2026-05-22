import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-saved-backup');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/savedBackup.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'savedBackup.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parseSavedPage,
	buildSavedUrl,
	mergeAndDedupe,
	buildExport,
} = await import(pathToFileURL(modulePath).href);

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
	const u = buildSavedUrl('with space', 't3_xyz', 200);
	assert.match(u, /\/user\/with%20space\//);
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

test('buildExport stamps schemaVersion, count, and an exportedAt timestamp', () => {
	const exp = buildExport('alice', [{ fullname: 't1_a', kind: 't1', id: 'a', subreddit: '', author: '', permalink: '', createdUtc: 0, body: '', title: '', url: '', score: 0 }]);
	assert.equal(exp.username, 'alice');
	assert.equal(exp.count, 1);
	assert.equal(exp.schemaVersion, 1);
	assert.ok(exp.exportedAt > 0);
});

test('savedBackup module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as savedBackup \} from '\.\/savedBackup';/);
	assert.match(index, /^\s*savedBackup,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/savedBackup.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/savedBackup'/);
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /buildSavedUrl\(/);
	for (const opt of ['pageLimit', 'maxPages']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
