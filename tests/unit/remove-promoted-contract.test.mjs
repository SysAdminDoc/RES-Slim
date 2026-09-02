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

test('current Reddit ad elements belong to the ad remover, not to a theme option', () => {
	// Three of these were hidden only by `html.res-pageTheme--declutter`, so a
	// user with ad removal on and declutter off saw every ad inside a discussion,
	// and the count the module reports never included one. A fourth,
	// `shreddit-dynamic-ad-link`, was covered nowhere at all.
	const source = read('lib/modules/removePromoted.js');
	const partial = read('lib/css/modules/_removePromoted.scss');
	const theme = read('lib/css/modules/_pageTheme.scss');

	for (const element of [
		'shreddit-comments-page-ad',
		'shreddit-comment-tree-ad',
		'shreddit-comment-tree-ads',
		'shreddit-sidebar-ad',
		'shreddit-dynamic-ad-link',
	]) {
		assert.ok(source.includes(`'${element}'`), `${element} is not in the module's selector list`);
		assert.ok(partial.includes(element), `${element} is not hidden by the module's own stylesheet`);
		assert.ok(!theme.includes(`--declutter ${element}`), `${element} is still gated on the declutter theme toggle`);
	}

	// An ad inside a discussion is not a post, so the Thing watcher cannot see one,
	// and current Reddit streams the comment tree so a document sweep misses it too.
	assert.match(source, /watchForFutureDescendants\(document\.body, D2X_AD_ELEMENTS\.join\(', '\)/);
	assert.match(source, /COUNTABLE_PROMOTED_SELECTOR/);
	assert.match(source, /const parent = el\.parentElement/);
	assert.match(source, /parent && parent\.closest\(COUNTABLE_PROMOTED_SELECTOR\)/);
	assert.match(source, /!el\.matches\('shreddit-comment-tree-ads'\) && !countableAncestor/);
});

test('the declutter toggle no longer decides whether ads are removed', () => {
	const theme = read('lib/css/modules/_pageTheme.scss');
	for (const element of ['shreddit-ad-post', 'faceplate-tracker[source=', 'article:has(shreddit-ad-post)']) {
		assert.ok(!theme.includes(`--declutter ${element}`), `${element} still rides on a theme option`);
	}
});
