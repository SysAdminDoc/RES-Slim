import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-gallery-zip');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/galleryZip.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'galleryZip.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	parseGalleryFromJson,
	safeFilename,
	paddedIndex,
	formatCaptionsText,
} = await import(pathToFileURL(modulePath).href);

function buildSampleJson() {
	return [{
		data: {
			children: [{
				data: {
					id: 'abc',
					is_gallery: true,
					gallery_data: {
						items: [
							{ media_id: 'mid1', caption: 'first' },
							{ media_id: 'mid2', caption: '' },
							{ media_id: 'mid3' /* no caption */ },
						],
					},
					media_metadata: {
						mid1: { m: 'image/jpeg', s: { u: 'https://preview.redd.it/mid1.jpg?w=1&amp;s=foo' } },
						mid2: { m: 'image/png', s: { u: 'https://preview.redd.it/mid2.png' } },
						mid3: { m: 'image/gif', s: { u: 'https://preview.redd.it/mid3.gif' } },
					},
				},
			}],
		},
	}, {}];
}

test('parseGalleryFromJson extracts items, decodes HTML entities, infers ext', () => {
	const items = parseGalleryFromJson(buildSampleJson());
	assert.equal(items.length, 3);
	assert.equal(items[0].url, 'https://preview.redd.it/mid1.jpg?w=1&s=foo', '&amp; decoded');
	assert.equal(items[0].ext, 'jpg');
	assert.equal(items[1].ext, 'png');
	assert.equal(items[2].caption, '');
});

test('parseGalleryFromJson returns empty for non-gallery posts', () => {
	const empty = parseGalleryFromJson([{ data: { children: [{ data: { is_gallery: false } }] } }, {}]);
	assert.deepEqual(empty, []);
	assert.deepEqual(parseGalleryFromJson(null), []);
	assert.deepEqual(parseGalleryFromJson([]), []);
});

test('safeFilename strips path chars, control chars, caps length', () => {
	assert.equal(safeFilename('hello/world?'), 'hello_world_');
	assert.equal(safeFilename('  '), 'gallery');
	assert.equal(safeFilename('x'.repeat(200)).length, 80);
});

test('paddedIndex zero-pads based on the total count', () => {
	assert.equal(paddedIndex(0, 9), '1');
	assert.equal(paddedIndex(0, 10), '01');
	assert.equal(paddedIndex(0, 100), '001');
});

test('formatCaptionsText emits one block per item with index, URL, caption', () => {
	const items = [
		{ url: 'https://x/1.jpg', caption: 'first', mediaId: 'm1', ext: 'jpg' },
		{ url: 'https://x/2.png', caption: '', mediaId: 'm2', ext: 'png' },
	];
	const out = formatCaptionsText(items);
	assert.match(out, /^1\.jpg/m);
	assert.match(out, /^2\.png/m);
	assert.match(out, /caption: first/);
	assert.match(out, /caption: \(none\)/);
});

test('galleryZip module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as galleryZip \} from '\.\/galleryZip';/);
	assert.match(index, /^\s*galleryZip,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/galleryZip.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/galleryZip'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	// Deliberately not pinned to a spelling: this asserted `import('jszip')` for its
	// whole life, which is the exact call that put 153KB of ZIP library into every
	// page load. The load path now has its own contracts in
	// gallery-zip-load-contract.test.mjs, which assert the property (not bundled,
	// injected on use) rather than the syntax.
	assert.match(mod, /loadScript\('\/jszip\.min\.js'\)/);
	assert.match(mod, /data-is-gallery/);
	for (const opt of ['includeCaptionsTxt', 'maxImages']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
