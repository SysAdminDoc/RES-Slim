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
	for (const hook of [
		'.thing.link.promoted',
		'.thing.link.promotedlink',
		'.thing.link[data-promoted="true"]',
		'.thing.link[data-adserver-imp-pixel]',
		'.thing.link[data-adserver-click-url]',
		'shreddit-ad-post',
		'shreddit-post[promoted]',
		'article[data-promoted="true"]',
	]) assert.ok(source.includes(`'${hook}'`), `missing promoted hook ${hook}`);
	assert.match(source, /module\.include\s*=\s*\['r2', 'd2x'\]/);
	assert.match(source, /module\.alwaysEnabled\s*=\s*true/);
	assert.match(source, /watchForThings\(\['post'\]/);
	assert.match(source, /dataset\.rsmPromotedHidden\s*=\s*'true'/);
	assert.match(source, /querySelector\('\.promoted-tag, \[data-promoted="true"\]'/);
	assert.match(source, /querySelector\('a\[href\*="\/\/alb\.reddit\.com\/"\]'/);
});

test('removePromoted ships a hidden-count badge styled in res.scss imports', () => {
	const css = read('lib/css/res.scss');
	assert.match(css, /@import 'modules\/removePromoted';/);
	const partial = read('lib/css/modules/_removePromoted.scss');
	assert.match(partial, /\.rsm-promoted-hidden-badge/);
	assert.match(partial, /\.thing\.link\.promotedlink/);
	assert.match(partial, /display:\s*none\s*!important/);
});
