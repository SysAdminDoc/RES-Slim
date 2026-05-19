import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('removePromoted module is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as removePromoted \} from '\.\/removePromoted';/);
	assert.match(index, /^\s*removePromoted,/m);
});

test('removePromoted matches both legacy class markup and the data-promoted attribute', () => {
	const source = read('lib/modules/removePromoted.js');
	assert.match(source, /PROMOTED_SELECTOR\s*=\s*'\.thing\.link\.promoted, \.thing\.link\[data-promoted="true"\]'/);
	assert.match(source, /module\.include\s*=\s*\['r2'\]/);
	assert.match(source, /watchForThings\(\['post'\]/);
	assert.match(source, /dataset\.rsmPromotedHidden\s*=\s*'true'/);
});

test('removePromoted ships a hidden-count badge styled in res.scss imports', () => {
	const css = read('lib/css/res.scss');
	assert.match(css, /@import 'modules\/removePromoted';/);
	const partial = read('lib/css/modules/_removePromoted.scss');
	assert.match(partial, /\.rsm-promoted-hidden-badge/);
});
