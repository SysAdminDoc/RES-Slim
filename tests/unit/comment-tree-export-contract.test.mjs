import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-comment-tree-export');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/commentTreeExport.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'commentTreeExport.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parsePostFromListing,
	parseCommentsFromListing,
	buildTree,
	toJson,
	toMarkdown,
	toHtml,
} = await import(pathToFileURL(modulePath).href);

const FIXTURE = [
	{ data: { children: [{ data: {
		id: 'p1', name: 't3_p1', subreddit: 'codex', author: 'op', title: 'Hello',
		selftext: 'Body text', url: 'https://example.com', score: 10, created_utc: 1700000000, permalink: '/r/codex/comments/p1/',
	} }] } },
	{ data: { children: [
		{ kind: 't1', data: {
			id: 'c1', name: 't1_c1', author: 'alice', body: 'first', score: 5, created_utc: 1700000100,
			permalink: '/r/codex/comments/p1/c1/', distinguished: null, stickied: false, edited: false,
			replies: { data: { children: [
				{ kind: 't1', data: {
					id: 'c2', name: 't1_c2', author: 'bob', body: 'nested', score: 3, created_utc: 1700000200,
					permalink: '/r/codex/comments/p1/c2/', distinguished: 'moderator', stickied: true, edited: 1700000300,
				} },
			] } },
		} },
	] } },
];

test('parsePostFromListing reads the canonical fields', () => {
	const post = parsePostFromListing(FIXTURE);
	assert.equal(post.title, 'Hello');
	assert.equal(post.author, 'op');
	assert.equal(post.subreddit, 'codex');
	assert.equal(post.selftext, 'Body text');
});

test('parsePostFromListing returns null on malformed input', () => {
	assert.equal(parsePostFromListing(null), null);
	assert.equal(parsePostFromListing([]), null);
	assert.equal(parsePostFromListing([{}, {}]), null);
});

test('parseCommentsFromListing walks the tree and tracks depth + parent', () => {
	const comments = parseCommentsFromListing(FIXTURE);
	assert.equal(comments.length, 2);
	assert.equal(comments[0].depth, 0);
	assert.equal(comments[0].parentId, null);
	assert.equal(comments[1].depth, 1);
	assert.equal(comments[1].parentId, 't1_c1');
	assert.equal(comments[1].distinguished, 'moderator');
	assert.equal(comments[1].stickied, true);
});

test('parseCommentsFromListing skips non-t1 kinds (more, etc.)', () => {
	const noisy = [
		{ data: { children: [] } },
		{ data: { children: [
			{ kind: 'more', data: { count: 5 } },
			{ kind: 't1', data: { id: 'c1', name: 't1_c1', author: 'a', body: 'x' } },
		] } },
	];
	const out = parseCommentsFromListing(noisy);
	assert.equal(out.length, 1);
	assert.equal(out[0].body, 'x');
});

test('buildTree stamps an exportedAt timestamp and schema version', () => {
	const tree = buildTree(FIXTURE);
	assert.ok(tree.exportedAt > 0);
	assert.equal(tree.schemaVersion, 1);
	assert.equal(tree.comments.length, 2);
});

test('toJson emits valid JSON that round-trips', () => {
	const tree = buildTree(FIXTURE);
	const json = toJson(tree);
	const parsed = JSON.parse(json);
	assert.equal(parsed.comments.length, 2);
});

test('toMarkdown emits the title heading and indented comment bodies', () => {
	const tree = buildTree(FIXTURE);
	const md = toMarkdown(tree);
	assert.match(md, /^# Hello/m);
	assert.match(md, /^> \*\*u\/alice\*\*/m);
	assert.match(md, /^> > \*\*u\/bob\*\*/m, 'nested comment indented twice');
});

test('toHtml escapes user content and emits the offline-viewable shell', () => {
	const dangerous = [
		{ data: { children: [{ data: { id: 'p1', name: 't3_p1', subreddit: 's', author: 'o', title: '<script>x</script>', selftext: 'safe', url: '', score: 1, created_utc: 1700000000, permalink: '/r/s/comments/p1/' } }] } },
		{ data: { children: [] } },
	];
	const html = toHtml(buildTree(dangerous));
	assert.match(html, /<!DOCTYPE html>/);
	assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/, 'script tags escaped');
	assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('commentTreeExport module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as commentTreeExport \} from '\.\/commentTreeExport';/);
	assert.match(index, /^\s*commentTreeExport,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/commentTreeExport.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/commentTreeExport'/);
	assert.match(mod, /isPageType\('comments'\)/);
	assert.ok(mod.includes('htmlOpenInNewTab'), 'expected option htmlOpenInNewTab');
});

test('commentTreeExport SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_commentTreeExport.scss');
	assert.ok(fs.existsSync(scssPath));
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/commentTreeExport'/);
});
