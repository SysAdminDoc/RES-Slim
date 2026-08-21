import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { markdown, markdownWiki } from 'snudown-js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('foreground Markdown users load the separate renderer entry', () => {
	const importers = [
		'lib/modules/commentPreview.js',
		'lib/modules/saveComments.js',
		'lib/modules/hosts/github.js',
		'lib/modules/hosts/tumblr.js',
	];
	for (const importer of importers) {
		assert.doesNotMatch(read(importer), /from ['"]snudown-js['"]/, `${importer} statically imports snudown-js`);
		assert.match(read(importer), /loadSnudown/);
	}

	assert.match(read('lib/utils/snudown.js'), /loadScript\('\/snudown\.entry\.js'\)/);
	assert.match(read('build.js'), /name: 'verify-snudown-lazy'/);
});

test('the lazy entry exposes both Reddit Markdown dialects', () => {
	const entry = read('lib/options/snudown.entry.js');
	assert.match(entry, /import \{ markdown, markdownWiki \} from 'snudown-js'/);
	assert.match(entry, /RESSnudown/);
});

test('Reddit-specific Markdown fixtures keep byte-identical output', () => {
	const fixtures = new Map([
		['/r/claude', '<p><a href="/r/claude">/r/claude</a></p>\n'],
		['>!spoiler!<', '<p><span class="md-spoiler-text">spoiler</span></p>\n'],
		['^superscript', '<p><sup>superscript</sup></p>\n'],
		['^(two words)', '<p><sup>two words</sup></p>\n'],
	]);

	for (const [source, expected] of fixtures) {
		assert.equal(markdown(source), expected);
		assert.equal(markdownWiki(source), expected);
	}
});
