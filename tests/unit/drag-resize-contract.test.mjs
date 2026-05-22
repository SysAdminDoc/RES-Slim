import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-drag-resize');
fs.mkdirSync(tmpDir, { recursive: true });
const src = fs.readFileSync(path.join(repoRoot, 'lib/utils/dragResize.js'), 'utf8');
const stripped = flowRemoveTypes(src, { all: true }).toString();
const modulePath = path.join(tmpDir, 'dragResize.mjs');
fs.writeFileSync(modulePath, stripped);
const { clampSize, applyAspectRatio, computeNextSize } = await import(pathToFileURL(modulePath).href);

test('clampSize enforces min and max independently per axis', () => {
	const out = clampSize(50, 4000, 100, 1000, 200, 2000);
	assert.equal(out.width, 100);
	assert.equal(out.height, 2000);
});

test('applyAspectRatio locks the chosen axis to the original ratio', () => {
	const lockW = applyAspectRatio(100, 50, 200, 999, 'lock-w');
	assert.equal(lockW.width, 200);
	assert.equal(lockW.height, 100);
	const lockH = applyAspectRatio(100, 50, 999, 100, 'lock-h');
	assert.equal(lockH.height, 100);
	assert.equal(lockH.width, 200);
	const free = applyAspectRatio(100, 50, 200, 300, 'free');
	assert.deepEqual(free, { width: 200, height: 300 });
});

test('computeNextSize tracks the dominant drag axis when aspect is locked', () => {
	const wide = computeNextSize(400, 200, 0, 0, 200, 10, {
		minWidth: 50, maxWidth: 2000, minHeight: 25, maxHeight: 1000, keepAspect: true,
	});
	assert.equal(wide.width, 600);
	assert.equal(wide.height, 300); // 600 * (200/400)
	const tall = computeNextSize(400, 200, 0, 0, 10, 100, {
		minWidth: 50, maxWidth: 2000, minHeight: 25, maxHeight: 1000, keepAspect: true,
	});
	assert.equal(tall.height, 300);
	assert.equal(tall.width, 600); // 300 / (200/400)
});

test('computeNextSize free mode tracks both axes independently and clamps', () => {
	const sz = computeNextSize(400, 200, 0, 0, 50, 50, {
		minWidth: 50, maxWidth: 2000, minHeight: 25, maxHeight: 1000, keepAspect: false,
	});
	assert.equal(sz.width, 450);
	assert.equal(sz.height, 250);
});

test('dragResize module is registered and uses the helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as dragResize \} from '\.\/dragResize';/);
	assert.match(index, /^\s*dragResize,/m);

	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/dragResize.js'), 'utf8');
	assert.match(mod, /from '\.\.\/utils\/dragResize'/);
	assert.match(mod, /computeNextSize\(/);
	assert.match(mod, /rsm-dragResize-handle/);
	for (const opt of ['keepAspect', 'persistPerHost', 'minWidth', 'maxWidth']) {
		assert.ok(mod.includes(opt), `expected option ${opt}`);
	}
});

test('dragResize SCSS ships in the bundle', () => {
	const scssPath = path.join(repoRoot, 'lib/css/modules/_dragResize.scss');
	assert.ok(fs.existsSync(scssPath));
	const resScss = fs.readFileSync(path.join(repoRoot, 'lib/css/res.scss'), 'utf8');
	assert.match(resScss, /@import 'modules\/dragResize'/);
});
