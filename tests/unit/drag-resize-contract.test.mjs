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
const { clampSize, applyAspectRatio, computeNextSize, computeKeyboardSize, KEYBOARD_STEP, KEYBOARD_STEP_LARGE } = await import(pathToFileURL(modulePath).href);

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
	assert.match(resScss, /@use 'modules\/dragResize'/);
});

// WCAG 2.2 SC 2.5.7 Dragging Movements. The handle was `pointerdown` and nothing
// else, on a `div` with no tabindex, so the feature was unreachable without a
// pointer. These cover the arithmetic; the e2e covers whether a keystroke
// actually gets to it.

const BOUNDS = { minWidth: 160, maxWidth: 1600, minHeight: 100, maxHeight: 4000, keepAspect: false };

test('the arrow keys move the handle the way a pointer would', () => {
	// The grip is at the bottom right, so right and down grow. Getting this
	// backwards is the kind of thing that reads fine in review and feels wrong in
	// one keystroke.
	assert.equal(computeKeyboardSize(400, 300, 'ArrowRight', false, BOUNDS).width, 400 + KEYBOARD_STEP);
	assert.equal(computeKeyboardSize(400, 300, 'ArrowLeft', false, BOUNDS).width, 400 - KEYBOARD_STEP);
	assert.equal(computeKeyboardSize(400, 300, 'ArrowDown', false, BOUNDS).height, 300 + KEYBOARD_STEP);
	assert.equal(computeKeyboardSize(400, 300, 'ArrowUp', false, BOUNDS).height, 300 - KEYBOARD_STEP);
});

test('an axis the key did not touch is left alone when the aspect is free', () => {
	const wider = computeKeyboardSize(400, 300, 'ArrowRight', false, BOUNDS);
	assert.equal(wider.height, 300);
	const taller = computeKeyboardSize(400, 300, 'ArrowDown', false, BOUNDS);
	assert.equal(taller.width, 400);
});

test('Shift takes a larger step, which is what makes the range crossable', () => {
	assert.equal(computeKeyboardSize(400, 300, 'ArrowRight', true, BOUNDS).width, 400 + KEYBOARD_STEP_LARGE);
	assert.ok(KEYBOARD_STEP_LARGE > KEYBOARD_STEP);
});

test('a locked aspect drives the other axis from whichever one moved', () => {
	const locked = { ...BOUNDS, keepAspect: true };
	const wider = computeKeyboardSize(400, 300, 'ArrowRight', false, locked);
	assert.equal(wider.width, 416);
	assert.equal(wider.height, 312);

	const taller = computeKeyboardSize(400, 300, 'ArrowDown', false, locked);
	assert.equal(taller.height, 316);
	assert.ok(Math.abs(taller.width - 421.33) < 0.1);
});

test('Home and End reach the limits without holding a key down', () => {
	const locked = { ...BOUNDS, keepAspect: true };
	assert.equal(computeKeyboardSize(400, 300, 'Home', false, locked).width, 160);
	assert.equal(computeKeyboardSize(400, 300, 'End', false, locked).width, 1600);
	// And they keep the shape, rather than snapping to a limit on one axis only.
	assert.equal(computeKeyboardSize(400, 300, 'Home', false, locked).height, 120);
});

test('the clamps apply to the keyboard path too', () => {
	assert.equal(computeKeyboardSize(160, 300, 'ArrowLeft', true, BOUNDS).width, 160);
	assert.equal(computeKeyboardSize(1600, 300, 'ArrowRight', true, BOUNDS).width, 1600);
});

test('a key this does not handle returns null, so the caller can leave the event alone', () => {
	// The distinction matters: consuming Tab would trap focus on the handle, and
	// consuming Enter would break whatever the page does with it.
	for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a', 'PageDown']) {
		assert.equal(computeKeyboardSize(400, 300, key, false, BOUNDS), null, `${key} should not be handled`);
	}
});

test('the handle is focusable and announced, or none of the above is reachable', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/dragResize.js'), 'utf8');
	assert.match(mod, /computeKeyboardSize\(/, 'the keyboard path must be wired, not just written');
	assert.match(mod, /addEventListener\('keydown'/);
	assert.match(mod, /setAttribute\('tabindex', '0'\)/, 'a separator without a tabindex cannot be focused');
	assert.match(mod, /aria-valuenow/, 'a focusable separator has to report where it is');
	assert.match(mod, /rsm-target-24/, 'the 14px grip needs the 24x24 target overlay for SC 2.5.8');
});
