import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-arctic-shift');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/arcticShift.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'arcticShift.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	DEFAULT_INSTANCE,
	sanitizeInstance,
	parseAutoLoadBudget,
	buildCommentUrl,
	buildPostUrl,
	parseCommentResponse,
	parsePostResponse,
	isDeletedBody,
} = await import(pathToFileURL(modulePath).href);

test('DEFAULT_INSTANCE points at the canonical Arctic Shift host', () => {
	assert.equal(DEFAULT_INSTANCE, 'https://arctic-shift.photon-reddit.com');
});

test('sanitizeInstance normalises scheme and trailing slash', () => {
	assert.equal(sanitizeInstance(''), DEFAULT_INSTANCE);
	assert.equal(sanitizeInstance('arctic.example.com/'), 'https://arctic.example.com');
	assert.equal(sanitizeInstance('http://arctic.example.com//'), 'http://arctic.example.com');
	assert.equal(sanitizeInstance('https://arctic.example.com/base/?ignored=1#frag'), 'https://arctic.example.com/base');
	assert.equal(sanitizeInstance('javascript:alert(1)'), DEFAULT_INSTANCE);
	assert.equal(sanitizeInstance('http://localhost:99999'), DEFAULT_INSTANCE);
});

test('parseAutoLoadBudget preserves zero and clamps negatives', () => {
	assert.equal(parseAutoLoadBudget('0'), 0);
	assert.equal(parseAutoLoadBudget('-5'), 0);
	assert.equal(parseAutoLoadBudget('12'), 12);
	assert.equal(parseAutoLoadBudget('garbage'), 25);
});

test('buildCommentUrl strips t1_ prefix and non-alphanumeric chars', () => {
	assert.equal(buildCommentUrl('https://arctic.example.com', 't1_abc'), 'https://arctic.example.com/api/comments/ids?ids=abc');
	assert.equal(buildCommentUrl('https://arctic.example.com', 'abc!def'), 'https://arctic.example.com/api/comments/ids?ids=abcdef');
});

test('buildPostUrl strips t3_ prefix', () => {
	assert.equal(buildPostUrl('https://arctic.example.com', 't3_xyz'), 'https://arctic.example.com/api/posts/ids?ids=xyz');
});

test('parseCommentResponse handles both `data` and `results` envelopes', () => {
	const a = parseCommentResponse({ data: [{ id: 'abc', author: 'alice', body: 'hello', created_utc: 100 }] });
	assert.equal(a.body, 'hello');
	assert.equal(a.author, 'alice');
	const b = parseCommentResponse({ results: [{ id: 'def', body: 'hi' }] });
	assert.equal(b.body, 'hi');
	assert.equal(b.author, 'unknown');
	assert.equal(parseCommentResponse({}), null);
	assert.equal(parseCommentResponse(null), null);
	assert.equal(parseCommentResponse({ data: [{ body: '' }] }), null, 'empty body rejected');
});

test('parsePostResponse normalises post fields', () => {
	const p = parsePostResponse({ data: [{ id: 't', author: 'a', title: 'T', selftext: 'S', url: 'https://x', created_utc: 200 }] });
	assert.equal(p.title, 'T');
	assert.equal(p.selftext, 'S');
	assert.equal(p.createdUtc, 200);
	assert.equal(parsePostResponse(null), null);
});

test('isDeletedBody recognises the canonical placeholder text only', () => {
	assert.equal(isDeletedBody('[removed]'), true);
	assert.equal(isDeletedBody('[deleted]'), true);
	assert.equal(isDeletedBody('  [removed]  '), true);
	assert.equal(isDeletedBody('hello'), false);
	assert.equal(isDeletedBody(null), false);
});

test('arcticShift module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as arcticShift \} from '\.\/arcticShift';/);
	assert.match(index, /^\s*arcticShift,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/arcticShift.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/arcticShift'/);
	assert.match(mod, /watchForThings\(\['comment'\]/);
	assert.match(mod, /createRateLimiter\(/);
	assert.match(mod, /href = '#'/, 'restore link should not use a javascript: URL');
	assert.match(mod, /parseAutoLoadBudget\(module\.options\.maxAutoLoad\.value\)/);
	for (const opt of ['instance', 'autoLoad', 'maxAutoLoad']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('arcticShift SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_arcticShift.scss');
	assert.ok(fs.existsSync(scssPath));
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@use 'modules\/arcticShift'/);
});
