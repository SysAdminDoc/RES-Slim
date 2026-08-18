import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

// The three stylesheet entry points esbuild is handed. Hardcoded so that adding a
// fourth to `build.js` fails this list rather than silently widening what counts
// as reachable — the assertion below is what keeps the two in step.
const ENTRIES = [
	'lib/options/options.scss',
	'lib/css/res.scss',
	'lib/environment/background/permissions/prompt.scss',
];

function collectScss(dir, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectScss(full, found);
		else if (entry.name.endsWith('.scss')) found.push(full);
	}
	return found;
}

function toPosix(absolute) {
	return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

// Sass resolves `@import 'modules/foo'` against the importing file's directory and
// tries both `foo.scss` and the partial form `_foo.scss`. Only those two forms
// appear in this tree; index files and load paths are not configured.
export function resolveImport(fromFile, specifier) {
	const dir = path.dirname(fromFile);
	const base = path.basename(specifier);
	const parent = path.dirname(specifier);
	for (const candidate of [`${base}.scss`, `_${base}.scss`]) {
		const full = path.resolve(dir, parent, candidate);
		if (fs.existsSync(full)) return full;
	}
	return null;
}

export function readImports(source) {
	// A commented-out `@import` has to be invisible here. Counting one keeps its
	// target "reachable", which is the exact direction this contract must not
	// fail in — an orphan would go unreported by the very line that orphaned it.
	const live = source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|\s)\/\/[^\r\n]*/g, '$1');

	// `@import '../vendor/index';` and `@use 'sass:math';` — the second is a
	// built-in module, not a file, and every built-in is `sass:`-prefixed.
	return [...live.matchAll(/@(?:import|use)\s+['"]([^'"]+)['"]/g)]
		.map(match => match[1])
		.filter(specifier => !specifier.startsWith('sass:'));
}

test('the import reader sees files, skips sass built-ins, and ignores commented-out imports', () => {
	assert.deepEqual(readImports("@import 'modules/hover';\n@use 'sass:math';\n@import \"../zindex\";"),
		['modules/hover', '../zindex']);
	assert.deepEqual(readImports("// @import 'modules/gone';"), []);
	assert.deepEqual(readImports("/* @import 'modules/gone';\n   @import 'modules/also-gone'; */"), []);
	// A URL in a comment is not an import, and the `//` in `https://` is not a
	// comment — the stripper keys on whitespace before the slashes for that reason.
	assert.deepEqual(readImports("@import 'a'; // see https://example.com/x"), ['a']);
});

test('the declared entry points are the ones build.js actually compiles', () => {
	const build = fs.readFileSync(path.join(repoRoot, 'build.js'), 'utf8');
	const declared = [...build.matchAll(/:\s*'\.\/(lib\/[^']+\.scss)'/g)].map(match => match[1]);
	assert.deepEqual(declared.sort(), [...ENTRIES].sort(),
		'build.js compiles a stylesheet this contract does not walk from');
});

test('every stylesheet in the tree is reachable from an entry point', () => {
	const all = new Set(collectScss(path.join(repoRoot, 'lib')).map(toPosix));
	assert.ok(all.size > 40, `expected the SCSS tree, found ${all.size} files`);

	const reachable = new Set();
	const queue = ENTRIES.map(relative => path.join(repoRoot, relative));
	while (queue.length) {
		const file = queue.pop();
		const relative = toPosix(file);
		if (reachable.has(relative)) continue;
		reachable.add(relative);
		for (const specifier of readImports(fs.readFileSync(file, 'utf8'))) {
			const resolved = resolveImport(file, specifier);
			assert.ok(resolved, `${relative} imports '${specifier}', which resolves to no file`);
			queue.push(resolved);
		}
	}

	// Twenty-two partials — 1,659 lines — sat here until v0.40.0, every one of them
	// the stylesheet of an upstream module stripped at v0.1.0. Nothing compiled
	// them, so they could not affect the page; what they did affect was every
	// reading of this tree. The z-index audit is the measured case: five of twelve
	// tokens looked live and were referenced only from partials that never shipped.
	//
	// They are not lost by deleting them. Re-porting one of those features copies
	// its implementation out of upstream's GPL-3.0 tree, and its stylesheet sits
	// beside it in the same commit; `git show v0.39.0:<path>` is the shorter route.
	const orphans = [...all].filter(relative => !reachable.has(relative)).sort();
	assert.deepEqual(orphans, [], `stylesheets no entry point imports:\n  ${orphans.join('\n  ')}`);
});
