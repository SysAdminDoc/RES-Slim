import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/searchGallery.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('searchGallery module is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as searchGallery \} from '\.\/searchGallery';/);
	assert.match(indexSource, /^\s*searchGallery,/m);
});

test('searchGallery reuses parseGalleryFromJson and the shared rate limiter', () => {
	assert.match(modSource, /from '\.\.\/utils\/galleryZip'/);
	assert.match(modSource, /createRateLimiter\(/);
	assert.match(modSource, /isPageType\('search'\)/);
});

test('searchGallery is disabled by default and scoped to search surface', () => {
	assert.match(modSource, /module\.disabledByDefault = true;/);
	assert.match(modSource, /module\.include = \['search'\]/);
});

test('searchGallery ships the documented options', () => {
	for (const opt of ['galleryStripCount', 'maxThumbWidth', 'onlyVisible']) {
		assert.ok(modSource.includes(opt), `expected option ${opt}`);
	}
});

test('searchGallery uses IntersectionObserver gated by onlyVisible', () => {
	assert.match(modSource, /new IntersectionObserver\(/);
	assert.match(modSource, /rootMargin: '300px 0px'/);
});

test('searchGallery SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_searchGallery.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /\.rsm-searchGallery-strip/);
	assert.match(scss, /prefers-reduced-motion: reduce/);
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/searchGallery'/);
});
