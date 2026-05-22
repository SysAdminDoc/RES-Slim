import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-media-manifest');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/mediaManifest.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'mediaManifest.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	SCHEMA_VERSION,
	DB_NAME,
	STORE_NAME,
	makeId,
	buildEntry,
	filterEntries,
	buildExport,
	isDownloadAnchor,
} = await import(pathToFileURL(modulePath).href);

test('constants are stable and documented', () => {
	assert.equal(SCHEMA_VERSION, 1);
	assert.equal(DB_NAME, 'rsm-mediaManifest');
	assert.equal(STORE_NAME, 'entries');
});

test('makeId composes timestamp + url prefix', () => {
	assert.equal(makeId('https://x', 100), '100::https://x');
});

test('buildEntry requires a URL and defaults source to manual', () => {
	const out = buildEntry({ url: 'https://x', filename: 'f', postPermalink: '/p/', postFullname: 't3_p', subreddit: 's', source: '', now: 1 });
	assert.equal(out.source, 'manual');
	assert.equal(out.url, 'https://x');
	assert.equal(buildEntry({ url: '', filename: '', postPermalink: '', postFullname: '', subreddit: '', source: '' }), null);
});

test('filterEntries filters by source / subreddit / time window', () => {
	const base = { id: '', url: '', filename: '', postPermalink: '', postFullname: '', subreddit: '', source: 'manual', mime: '', bytes: 0, timestamp: 0 };
	const a = { ...base, id: '1', source: 'cobalt', subreddit: 'Pics', timestamp: 100 };
	const b = { ...base, id: '2', source: 'galleryZip', subreddit: 'news', timestamp: 200 };
	const all = [a, b];
	assert.deepEqual(filterEntries(all, { source: 'cobalt' }).map(x => x.id), ['1']);
	assert.deepEqual(filterEntries(all, { subreddit: 'PICS' }).map(x => x.id), ['1']);
	assert.deepEqual(filterEntries(all, { since: 150 }).map(x => x.id), ['2']);
});

test('buildExport stamps schemaVersion, count, exportedAt', () => {
	const out = buildExport([]);
	assert.equal(out.schemaVersion, 1);
	assert.equal(out.count, 0);
	assert.ok(out.exportedAt > 0);
});

test('isDownloadAnchor recognises [download] anchors and the known RES-Slim classes', () => {
	function makeAnchor(attrs) {
		return {
			tagName: 'A',
			className: attrs.className || '',
			getAttribute(name) { return attrs[name] || null; },
			hasAttribute(name) { return name in attrs; },
		};
	}
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'https://x', download: 'x.mp4' })), true);
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'https://x', className: 'rsm-cobalt-btn' })), true);
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'https://x', className: 'rsm-galleryZip-btn' })), true);
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'https://x', className: 'rsm-localCompanion-btn' })), true);
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'https://x', className: 'RES-download' })), true);
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'https://x', className: 'unrelated' })), false);
	assert.equal(isDownloadAnchor(makeAnchor({ href: '#', download: 'x' })), false);
	assert.equal(isDownloadAnchor(makeAnchor({ href: 'javascript:void 0', download: 'x' })), false);
	assert.equal(isDownloadAnchor(null), false);
});

test('mediaArchiveManifest module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as mediaArchiveManifest \} from '\.\/mediaArchiveManifest';/);
	assert.match(index, /^\s*mediaArchiveManifest,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/mediaArchiveManifest.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/mediaManifest'/);
	assert.match(mod, /indexedDB\.open\(/);
	assert.match(mod, /isDownloadAnchor\(/);
	for (const opt of ['maxEntries', 'trackHrefDownloads']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});
