import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-per-sub-css');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/perSubCss.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'perSubCss.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parseSubList,
	normalizeMode,
	currentSubFromPath,
	shouldStripStyles,
} = await import(pathToFileURL(modulePath).href);

test('parseSubList lowercases, dedupes, strips /r/ prefix', () => {
	assert.deepEqual(parseSubList('Pics, /r/Gaming, pics, news'), ['pics', 'gaming', 'news']);
	assert.deepEqual(parseSubList('r/foo\nbar\n  baz '), ['foo', 'bar', 'baz']);
	assert.deepEqual(parseSubList(''), []);
	assert.deepEqual(parseSubList(undefined), []);
});

test('normalizeMode falls back to per-list', () => {
	assert.equal(normalizeMode('allow-all'), 'allow-all');
	assert.equal(normalizeMode('deny-all'), 'deny-all');
	assert.equal(normalizeMode('per-list'), 'per-list');
	assert.equal(normalizeMode('bogus'), 'per-list');
	assert.equal(normalizeMode(undefined), 'per-list');
});

test('currentSubFromPath returns lowercase sub or empty', () => {
	assert.equal(currentSubFromPath('/r/Pics/'), 'pics');
	assert.equal(currentSubFromPath('/r/news/comments/abc/'), 'news');
	assert.equal(currentSubFromPath('/'), '');
	assert.equal(currentSubFromPath('/user/alice'), '');
});

test('shouldStripStyles in allow-all mode strips only deny-listed subs', () => {
	assert.equal(shouldStripStyles('pics', 'allow-all', [], ['gaming']), false);
	assert.equal(shouldStripStyles('gaming', 'allow-all', [], ['gaming']), true);
	assert.equal(shouldStripStyles('', 'allow-all', [], ['gaming']), false, 'front page is not stripped in allow-all');
});

test('shouldStripStyles in deny-all mode keeps only allow-listed subs', () => {
	assert.equal(shouldStripStyles('pics', 'deny-all', ['pics'], []), false);
	assert.equal(shouldStripStyles('news', 'deny-all', ['pics'], []), true);
	assert.equal(shouldStripStyles('', 'deny-all', ['pics'], []), true, 'front page is stripped in deny-all');
});

test('shouldStripStyles in per-list mode is default-keep, deny strips', () => {
	assert.equal(shouldStripStyles('pics', 'per-list', ['news'], ['gaming']), false);
	assert.equal(shouldStripStyles('gaming', 'per-list', ['news'], ['gaming']), true);
	assert.equal(shouldStripStyles('news', 'per-list', ['news'], ['gaming']), false);
	assert.equal(shouldStripStyles('', 'per-list', [], []), false);
});

test('perSubCss module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as perSubCss \} from '\.\/perSubCss';/);
	assert.match(index, /^\s*perSubCss,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/perSubCss.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/perSubCss'/);
	assert.match(mod, /applied_subreddit_stylesheet/);
	for (const opt of ['mode', 'denyList', 'allowList']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
