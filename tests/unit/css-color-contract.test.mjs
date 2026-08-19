import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

import { readCode } from './helpers/readCode.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-css-color');
fs.mkdirSync(tmpDir, { recursive: true });

const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/cssColor.js'), 'utf8');
const modulePath = path.join(tmpDir, 'cssColor.mjs');
fs.writeFileSync(modulePath, flowRemoveTypes(source, { all: true }).toString());
const { parseColor, sameColor } = await import(pathToFileURL(modulePath).href);

// This replaced tinycolor2, which shipped 28.6KB into each of three bundles for a
// surface that had shrunk to one comparison in one migration. The vectors below
// are the ones `lib/utils/__tests__/color.js` carried. They were written for
// `ava` and it seemed safe to assume they were dead, since `ava` is not
// installed — but `tests/unit/utils-specs.test.mjs` shims it and runs every spec
// in that directory, and deleting the file turned that suite red. They were live
// coverage, and they are carried over here rather than dropped.

test('hex parses in every length the spec allows, and only those', () => {
	assert.deepEqual(parseColor('#aabbcc'), { r: 170, g: 187, b: 204, a: 1 });
	assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
	assert.deepEqual(parseColor('#AABBCC'), { r: 170, g: 187, b: 204, a: 1 });
	assert.deepEqual(parseColor('#010203'), { r: 1, g: 2, b: 3, a: 1 });

	// 4- and 8-digit forms carry alpha.
	assert.deepEqual(parseColor('#abcd'), { r: 170, g: 187, b: 204, a: 221 / 255 });
	assert.deepEqual(parseColor('#aabbcc80'), { r: 170, g: 187, b: 204, a: 128 / 255 });

	// 5 and 7 digits are not colours, however plausible they look.
	assert.equal(parseColor('#aabbc'), null);
	assert.equal(parseColor('#aabbccd'), null);
	assert.equal(parseColor('#gg0000'), null, 'non-hex digits are not a colour');
});

test('the rgb family parses in both the comma and the space spelling', () => {
	assert.deepEqual(parseColor('rgb(1,2,3)'), { r: 1, g: 2, b: 3, a: 1 });
	assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
	assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
	assert.deepEqual(parseColor('rgb(1 2 3)'), { r: 1, g: 2, b: 3, a: 1 });
	assert.deepEqual(parseColor('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
	// Percentage channels are relative to 255, not to 100.
	assert.deepEqual(parseColor('rgb(100%, 0%, 0%)'), { r: 255, g: 0, b: 0, a: 1 });
	// Out-of-range channels clamp, as every engine does.
	assert.deepEqual(parseColor('rgb(300, -20, 3)'), { r: 255, g: 0, b: 3, a: 1 });

	assert.equal(parseColor('rgb(1, 2)'), null, 'three channels or it is not a colour');
	assert.equal(parseColor('rgb(1, 2, blue)'), null);
});

test('anything else is not a colour, and says so rather than guessing', () => {
	// The old vectors expected `to('not a color')` to give [0, 0, 0] — tinycolor
	// returned black for anything it could not read, so a typo in a stored option
	// became a real colour instead of an error. Answering null is what lets the
	// one caller leave the stored value alone.
	assert.equal(parseColor('not a color'), null);
	assert.equal(parseColor(''), null);
	assert.equal(parseColor('   '), null);
	assert.equal(parseColor(null), null);
	assert.equal(parseColor(undefined), null);
	assert.equal(parseColor(0x00ff00), null, 'a number is not a CSS colour');
	// Named colours are deliberately unsupported; see the module header.
	assert.equal(parseColor('white'), null);
});

test('sameColor answers only when both sides parse', () => {
	// The case that matters to the caller: two spellings of one colour.
	assert.equal(sameColor('#DDD', '#dddddd'), true);
	assert.equal(sameColor('#373737', 'rgb(55, 55, 55)'), true);
	assert.equal(sameColor('rgba(0, 0, 0, 1)', '#000000'), true);
	assert.equal(sameColor('rgb(1 2 3 / 50%)', 'rgba(1, 2, 3, 0.5)'), true);

	assert.equal(sameColor('#000000', '#000001'), false);
	assert.equal(sameColor('rgba(0, 0, 0, 0.5)', '#000000'), false, 'alpha is part of the colour');

	// Unparseable on either side is false — the safe direction, because the caller
	// reacts to `true` by overwriting stored options.
	assert.equal(sameColor('white', 'white'), false);
	assert.equal(sameColor('#fff', 'nonsense'), false);
	assert.equal(sameColor(null, null), false);
});

test('the migration that uses it still short-circuits on an identical string', () => {
	// `colorsMatch` checks `fg === bg` before parsing, which is what keeps the
	// unsupported spellings harmless: two identical values match whatever they are.
	// Comments blanked: the migration's own comment explains what tinycolor2 was
	// replaced by, and reading that as the offence fails on a correct file.
	const migrate = readCode('lib/core/migrate/migrate.js');
	assert.match(migrate, /function colorsMatch\(fg, bg\) \{\s*\n\s*if \(fg === bg\) return true;/);
	assert.match(migrate, /return sameColor\(fg, bg\);/);
	assert.doesNotMatch(migrate, /tinycolor/);
});

test('tinycolor2 is gone from the manifest and from every bundle', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
	assert.equal(pkg.dependencies?.tinycolor2, undefined);
	assert.equal(pkg.devDependencies?.tinycolor2, undefined);

	// The metafile is the only place that can prove it left the output, rather
	// than merely leaving the import graph of one file.
	const metaPath = path.join(repoRoot, 'dist', 'esbuild-meta-chrome.json');
	if (!fs.existsSync(metaPath)) return; // build not run yet; `yarn verify` covers it
	const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
	const carriers = Object.entries(meta.outputs)
		.filter(([, output]) => Object.keys(output.inputs || {}).some(input => input.includes('tinycolor')))
		.map(([name]) => name);
	assert.deepEqual(carriers, [], `tinycolor2 is still bundled into:\n  ${carriers.join('\n  ')}`);
});
