import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('threadMinimap is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as threadMinimap \} from '\.\/threadMinimap';/);
	assert.match(index, /^\s*threadMinimap,/m);
});

test('threadMinimap stays inside comment pages and exposes side+colour modes', () => {
	const source = read('lib/modules/threadMinimap.js');
	assert.match(source, /module\.include\s*=\s*\['comments'\]/);
	assert.match(source, /side:\s*\{[\s\S]*?type:\s*'enum'/);
	assert.match(source, /colourMode:\s*\{[\s\S]*?type:\s*'enum'/);
});

test('threadMinimap does not block comment scrolling', () => {
	const css = read('lib/css/modules/_threadMinimap.scss');
	assert.match(css, /\.rsm-thread-minimap\s*\{[^}]*pointer-events:\s*none/);
	assert.match(css, /\.rsm-thread-minimap-rail\s*\{[^}]*pointer-events:\s*auto/);
	assert.match(css, /\.rsm-thread-minimap-viewport\s*\{[^}]*pointer-events:\s*none/m);
});

test('threadMinimap paints one stripe per .thing.comment and jumps on click', () => {
	const source = read('lib/modules/threadMinimap.js');
	assert.match(source, /'\.commentarea \.thing\.comment'/);
	assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/);
});

test('threadMinimap supports a scroll-tracking viewport rectangle', () => {
	const source = read('lib/modules/threadMinimap.js');
	assert.match(source, /function updateViewport\(\)/);
	assert.match(source, /window\.addEventListener\('scroll', updateViewport/);
});

test('threadMinimap CSS partial is imported from res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.match(res, /@import 'modules\/threadMinimap';/);
});
