import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-hover-zoom');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/hoverZoom.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'hoverZoom.mjs');
fs.writeFileSync(modulePath, stripped);
const {
	classifyUrl,
	normalizePreviewUrl,
	inferUrlFromAnchor,
	placePopover,
} = await import(pathToFileURL(modulePath).href);

test('classifyUrl returns image / video / none', () => {
	assert.equal(classifyUrl('https://i.redd.it/foo.png'), 'image');
	assert.equal(classifyUrl('https://i.redd.it/foo.JPG?w=200'), 'image');
	assert.equal(classifyUrl('https://v.redd.it/x.mp4'), 'video');
	assert.equal(classifyUrl('https://imgur.com/abc.gifv'), 'video');
	assert.equal(classifyUrl('https://example.com/page'), 'none');
	assert.equal(classifyUrl(null), 'none');
});

test('normalizePreviewUrl rewrites .gifv to .mp4', () => {
	assert.equal(normalizePreviewUrl('https://imgur.com/abc.gifv'), 'https://imgur.com/abc.mp4');
	assert.equal(normalizePreviewUrl('https://i.redd.it/x.png'), 'https://i.redd.it/x.png');
});

test('inferUrlFromAnchor picks the first direct candidate', () => {
	assert.equal(inferUrlFromAnchor('https://reddit.com/r/x', 'https://i.redd.it/y.png'), 'https://i.redd.it/y.png');
	assert.equal(inferUrlFromAnchor('https://i.redd.it/z.jpg', ''), 'https://i.redd.it/z.jpg');
	assert.equal(inferUrlFromAnchor('https://reddit.com/r/x', ''), '');
});

test('placePopover prefers right-of-cursor and flips on overflow', () => {
	const W = 1000, H = 600;
	const pw = 400, ph = 300;
	const right = placePopover(100, 300, W, H, pw, ph, 12);
	assert.equal(right.attach, 'right');
	assert.equal(right.x, 112);
	const left = placePopover(900, 300, W, H, pw, ph, 12);
	assert.equal(left.attach, 'left');
	assert.ok(left.x < 900);
});

test('placePopover clamps to viewport on all edges', () => {
	const pos = placePopover(5, 5, 1000, 600, 400, 300, 12);
	assert.equal(pos.y, 12, 'top clamp');
	const bottom = placePopover(5, 590, 1000, 600, 400, 300, 12);
	assert.ok(bottom.y + 300 + 12 <= 600, 'bottom clamp');
});

test('hoverZoom module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as hoverZoom \} from '\.\/hoverZoom';/);
	assert.match(index, /^\s*hoverZoom,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/hoverZoom.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/hoverZoom'/);
	assert.match(mod, /POPOVER_ID = 'rsm-hoverZoom-popover'/);
	for (const opt of ['delayMs', 'maxWidth', 'maxHeight', 'muteVideos', 'requireDirectUrl']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('hoverZoom SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_hoverZoom.scss');
	assert.ok(fs.existsSync(scssPath));
	const scss = fs.readFileSync(scssPath, 'utf8');
	assert.match(scss, /#rsm-hoverZoom-popover/);
	assert.match(scss, /prefers-reduced-motion: reduce/);
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/hoverZoom'/);
});
