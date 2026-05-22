import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/mediaScopeToggle.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('mediaScopeToggle is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as mediaScopeToggle \} from '\.\/mediaScopeToggle';/);
	assert.match(indexSource, /^\s*mediaScopeToggle,/m);
});

test('mediaScopeToggle ships the four documented options', () => {
	for (const opt of ['suppressInPosts', 'suppressInComments', 'keepThumbnail', 'collapseLoadedExpando']) {
		assert.ok(modSource.includes(opt), `expected option ${opt}`);
	}
});

test('mediaScopeToggle defaults suppress comments + keep thumbnails, not posts', () => {
	function pickDefault(opt) {
		const re = new RegExp(`${opt}:\\s*\\{[\\s\\S]*?value:\\s*(true|false)`);
		const m = re.exec(modSource);
		return m ? m[1] : '';
	}
	assert.equal(pickDefault('suppressInPosts'), 'false');
	assert.equal(pickDefault('suppressInComments'), 'true');
	assert.equal(pickDefault('keepThumbnail'), 'true');
	assert.equal(pickDefault('collapseLoadedExpando'), 'true');
});

test('mediaScopeToggle body classes follow the rsm- convention', () => {
	assert.match(modSource, /POSTS_CLASS = 'rsm-mediaScope-noPosts'/);
	assert.match(modSource, /COMMENTS_CLASS = 'rsm-mediaScope-noComments'/);
	assert.match(modSource, /NO_THUMB_CLASS = 'rsm-mediaScope-noThumb'/);
});

test('mediaScopeToggle targets the documented expando + thumbnail selectors', () => {
	assert.match(modSource, /\.expando-button/);
	assert.match(modSource, /\.expando/);
	assert.match(modSource, /a\.thumbnail/);
	assert.match(modSource, /\.commentarea \.thing\.comment/);
});

test('mediaScopeToggle is disabled by default and ships both lifecycle hooks', () => {
	assert.match(modSource, /module\.disabledByDefault = true;/);
	assert.match(modSource, /module\.beforeLoad = \(\) =>/);
	assert.match(modSource, /module\.contentStart = \(\) =>/);
});

test('mediaScopeToggle re-collapses late-initialising expandos via watchForThings', () => {
	assert.match(modSource, /watchForThings\(\['post', 'comment'\]/);
	assert.match(modSource, /\.expando-button\.expanded/);
});
