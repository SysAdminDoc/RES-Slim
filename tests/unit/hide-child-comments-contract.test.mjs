import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('hide child comments is registered and scoped to old reddit comment pages', () => {
	const index = read('lib/modules/index.js');
	const source = read('lib/modules/hideChildComments.js');

	assert.match(index, /import \{ module as hideChildComments \} from '\.\/hideChildComments'/);
	assert.match(index, /\bhideChildComments,/);
	assert.match(source, /new Module\('hideChildComments'\)/);
	assert.match(source, /module\.include = \[\s*'comments',\s*\]/);
	assert.match(source, /watchForThings\(\['comment'\], addToggleChildrenButton\)/);
	assert.match(source, /watchForThings\(\['post'\], addToggleAllButton\)/);
});

test('hide child comments preserves upstream toggle contracts', () => {
	const source = read('lib/modules/hideChildComments.js');

	assert.match(source, /class', 'toggleChildren noCtrlF'/);
	assert.match(source, /class', 'noCtrlF res-toggleAllChildren'/);
	assert.match(source, /a\.setAttribute\('action', 'show'\)/);
	assert.match(source, /a\.setAttribute\('action', 'hide'\)/);
	assert.match(source, /comment\.element\.classList\.toggle\('res-children-hidden', action === 'hide'\)/);
	assert.match(source, /document\.querySelectorAll\(`\$\{selector\} > \.entry \.toggleChildren\[action=\$\{action\}\]`\)/);
});

test('hide child comments accepts current old reddit child containers', () => {
	const source = read('lib/modules/hideChildComments.js');

	assert.match(source, /function getChildrenContainer\(comment\)/);
	assert.match(source, /querySelector\('div\.child > \.sitetable'\)/);
	assert.match(source, /querySelector\('div\.child'\)/);
	assert.match(source, /const children = getChildrenContainer\(comment\)/);
});
