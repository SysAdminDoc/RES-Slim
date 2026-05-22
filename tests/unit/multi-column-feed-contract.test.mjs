import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/multiColumnFeed.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('multiColumnFeed module is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as multiColumnFeed \} from '\.\/multiColumnFeed';/);
	assert.match(indexSource, /^\s*multiColumnFeed,/m);
});

test('multiColumnFeed exposes columnCount enum with 2/3/4 plus the polish toggles', () => {
	assert.match(modSource, /columnCount/);
	for (const v of ['2', '3', '4']) {
		assert.ok(modSource.includes(`value: '${v}'`), `expected column count value ${v}`);
	}
	for (const opt of ['includeSelfPosts', 'useFullWidth']) {
		assert.ok(modSource.includes(opt), `expected option ${opt}`);
	}
});

test('multiColumnFeed grid scopes to listing pages and uses #siteTable.linklisting', () => {
	assert.match(modSource, /isPageType\('linklist'\)/);
	assert.match(modSource, /#siteTable\.linklisting/);
	assert.match(modSource, /grid-template-columns: repeat\(\$\{cols\}/);
});

test('multiColumnFeed full-row affordances span 1 / -1 for non-thing children', () => {
	assert.match(modSource, /grid-column: 1 \/ -1/);
	assert.match(modSource, /> \.nav-buttons/);
});

test('multiColumnFeed is disabled by default and excludes thread/profile via include', () => {
	assert.match(modSource, /module\.disabledByDefault = true;/);
	assert.match(modSource, /module\.include = \['linklist', 'search'\]/);
});

test('multiColumnFeed ships both beforeLoad and contentStart hooks', () => {
	assert.match(modSource, /module\.beforeLoad = \(\) =>/);
	assert.match(modSource, /module\.contentStart = \(\) =>/);
	assert.match(modSource, /STYLE_ID = 'RSMMultiColumnFeedStyle'/);
});

test('multiColumnFeed body class follows the rsm- convention', () => {
	assert.match(modSource, /BODY_CLASS = 'rsm-multiColumnFeed'/);
});
