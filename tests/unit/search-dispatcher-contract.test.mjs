import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('searchDispatcher is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as searchDispatcher \} from '\.\/searchDispatcher';/);
	assert.match(index, /^\s*searchDispatcher,/m);
});

test('searchDispatcher ships default targets covering Reddit, sub, Google, DuckDuckGo', () => {
	const source = read('lib/modules/searchDispatcher.js');
	for (const key of ['reddit', 'sub', 'google-site', 'ddg-site']) {
		assert.ok(source.includes(`key: '${key}'`), `expected target ${key}`);
	}
});

test('searchDispatcher parses custom targets from the option text', () => {
	const source = read('lib/modules/searchDispatcher.js');
	assert.match(source, /function parseCustomTargets/);
	assert.match(source, /customTargets:/);
	assert.match(source, /if \(!template\.includes\('\{q\}'\)\) return null/);
});

test('searchDispatcher persists the user choice across reloads', () => {
	const source = read('lib/modules/searchDispatcher.js');
	assert.match(source, /'rsm-search-dispatcher-target'/);
});

test('searchDispatcher only intercepts non-default targets so Reddit form posts still work', () => {
	const source = read('lib/modules/searchDispatcher.js');
	assert.match(source, /if \(!target \|\| target\.key === 'reddit'\) return;/);
});

test('searchDispatcher hides the "this subreddit" option outside of /r/<sub> routes', () => {
	const source = read('lib/modules/searchDispatcher.js');
	assert.match(source, /if \(target\.key === 'sub' && !sub\) continue/);
});

test('searchDispatcher styles + integrates with res.scss imports', () => {
	const res = read('lib/css/res.scss');
	assert.match(res, /@import 'modules\/searchDispatcher';/);
	const css = read('lib/css/modules/_searchDispatcher.scss');
	assert.match(css, /\.rsm-search-dispatcher/);
});
