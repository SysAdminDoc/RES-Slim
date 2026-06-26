import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-crosspost-map');
fs.mkdirSync(tmpDir, { recursive: true });
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/crosspostMap.js'), 'utf8');
const stripped = flowRemoveTypes(source, { all: true }).toString();
const modulePath = path.join(tmpDir, 'crosspostMap.mjs');
fs.writeFileSync(modulePath, stripped);

const {
	extractArticleId,
	buildDuplicatesUrl,
	parseDuplicatesResponse,
	relativeAge,
} = await import(pathToFileURL(modulePath).href);

test('extractArticleId pulls the t3 id from a comments permalink', () => {
	assert.equal(extractArticleId('/r/codex/comments/1th66mb/this_has_to_stop/'), '1th66mb');
	assert.equal(extractArticleId('/r/pics/comments/abcdef'), 'abcdef');
	assert.equal(extractArticleId('/r/pics/'), '');
	assert.equal(extractArticleId(undefined), '');
});

test('buildDuplicatesUrl sanitises and emits the legacy JSON path', () => {
	assert.equal(buildDuplicatesUrl('1th66mb'), 'https://old.reddit.com/duplicates/1th66mb/.json?limit=50');
	assert.equal(buildDuplicatesUrl('1th!66mb'), 'https://old.reddit.com/duplicates/1th66mb/.json?limit=50');
});

test('parseDuplicatesResponse extracts subreddit/score/comments and sorts newest first', () => {
	const raw = [
		{ data: { children: [{ data: { id: 'orig', name: 't3_orig' } }] } },
		{
			data: {
				children: [
					{ data: { id: 'a', name: 't3_a', subreddit: 'pics', author: 'alice', score: 5, num_comments: 2, created_utc: 1000, permalink: '/r/pics/comments/a/', url: 'https://i.redd.it/a.jpg' } },
					{ data: { id: 'b', name: 't3_b', subreddit: 'all', author: 'bob', score: 10, num_comments: 3, created_utc: 2000, permalink: '/r/all/comments/b/', url: 'https://i.redd.it/b.jpg' } },
					{ data: { id: 'orig', name: 't3_orig', subreddit: 'codex', author: 'x', score: 1, num_comments: 1, created_utc: 3000, permalink: '/r/codex/comments/orig/', url: '' } },
				],
			},
		},
	];
	const list = parseDuplicatesResponse(raw, 't3_orig');
	assert.equal(list.length, 2, 'self post is excluded');
	assert.deepEqual(list.map(d => d.id), ['b', 'a'], 'newest first');
	assert.equal(list[0].subreddit, 'all');
	assert.equal(list[0].numComments, 3);
});

test('parseDuplicatesResponse fails closed on malformed input', () => {
	assert.deepEqual(parseDuplicatesResponse(null, ''), []);
	assert.deepEqual(parseDuplicatesResponse([], ''), []);
	assert.deepEqual(parseDuplicatesResponse([{}, {}], ''), []);
	assert.deepEqual(parseDuplicatesResponse([{}, { data: { children: 'not-an-array' } }], ''), []);
});

test('relativeAge formats seconds/minutes/hours/days/months/years', () => {
	const NOW = 2_000_000_000_000;
	assert.equal(relativeAge(NOW / 1000 - 10, NOW), 'just now');
	assert.equal(relativeAge(NOW / 1000 - 60 * 5, NOW), '5m ago');
	assert.equal(relativeAge(NOW / 1000 - 60 * 60 * 3, NOW), '3h ago');
	assert.equal(relativeAge(NOW / 1000 - 60 * 60 * 24 * 5, NOW), '5d ago');
	assert.equal(relativeAge(NOW / 1000 - 60 * 60 * 24 * 60, NOW), '2mo ago');
	assert.equal(relativeAge(NOW / 1000 - 60 * 60 * 24 * 730, NOW), '2y ago');
});

test('crosspostMap module is registered and wires the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as crosspostMap \} from '\.\/crosspostMap';/);
	assert.match(index, /^\s*crosspostMap,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/crosspostMap.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/crosspostMap'/);
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /\/duplicates\//);
	assert.match(mod, /isPageType\('comments'\)/);
	for (const opt of ['autoLoad', 'maxItems', 'hideWhenEmpty']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('crosspostMap exposes a labeled region with live status and stateful retry', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/crosspostMap.js'), 'utf8');
	assert.match(mod, /setAttribute\('role', 'region'\)/);
	assert.match(mod, /setAttribute\('aria-labelledby', TITLE_ID\)/);
	assert.match(mod, /setAttribute\('aria-live', 'polite'\)/);
	assert.match(mod, /function setStatus/);
	assert.match(mod, /host\.dataset\.state = kind/);
	assert.match(mod, /btn\.textContent = 'Retry'/);
});

test('crosspostMap SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_crosspostMap.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /\.rsm-crosspostMap/);
	assert.match(scss, /&-status/);
	assert.match(scss, /\[data-state='success'\]/);
	assert.match(scss, /\[data-state='error'\]/);
	assert.match(scss, /\[data-state='empty'\]/);
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/crosspostMap'/);
});
