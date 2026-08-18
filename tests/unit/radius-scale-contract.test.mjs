// One radius scale, enforced across every shipped stylesheet.
//
// CLAUDE.md and the project notes both said this was already enforced by a
// contract test. It was not. What existed were four mutually inconsistent pill
// greps over disjoint subsets of files, one of which matched the literal `999px`
// only — so `9999px` sailed through. Meanwhile about fifty off-scale literals
// shipped: 3px twenty-one times, 7px nine, 5px seven.
//
// That combination is worse than having no rule. A documented invariant nothing
// checks is a claim every later reader trusts and no later change has to honour,
// and this repo has now hit that same shape four times (the Chrome manifest
// floor, the GitHub repo description, the Toolbox-NXG search proof, and this).

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const libDir = path.join(repoRoot, 'lib');

function scssFiles(dir = libDir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...scssFiles(full));
		else if (entry.name.endsWith('.scss')) out.push(full);
	}
	return out;
}

// The declared scale, and nothing else. Values may be written as a literal or
// through a token — a token whose value is off-scale is caught by the token test
// below, so there is no way through either.
const SCALE_PX = [4, 6, 8, 10, 12];

// `0` is a square, not a size — every surface is entitled to be one.
const SHAPES = new Set(['0']);

// Circles, listed one at a time. A blanket "50% is fine" would exempt exactly
// the case the older no-pill rule existed to catch: a content surface rounded
// into a lozenge. Each of these is a shape whose whole job is to be round — a
// spinner, a status dot, a toggle thumb, a colour swatch — so the allowlist is
// short and adding to it is a decision someone has to make on purpose.
const CIRCLES = new Set([
	'lib/css/res.scss:439',   // .csspinner ring
	'lib/css/res.scss:707',   // full-page loading spinner
	'lib/options/options.scss:2858',  // .globalStageIcon status dot
	'lib/options/options.scss:3107',  // .moduleButton::before enabled dot
	'lib/options/options.scss:3437',  // toggle thumb
	'lib/options/options.scss:3478',  // .workspaceEmptyStateIcon
	'lib/options/options.scss:3605',  // theme swatch
	'lib/options/options.scss:3684',  // theme swatch, forced-colors
]);

const RADIUS_DECL = /border-radius:\s*([^;{}]+);/g;
const TOKEN_DEF = /--([\w-]*radius[\w-]*):\s*([^;]+);/g;

// Every radius token defined anywhere in the tree, and its value. Collected
// rather than hardcoded by prefix: there are three scales (`--rsm-` in the page,
// `--options-` in the console, `--prompt-` in the permission dialog), and a
// fourth would otherwise be exempt from this contract simply by being new.
const radiusTokens = new Map();
for (const file of scssFiles()) {
	const source = fs.readFileSync(file, 'utf8');
	for (const [, name, value] of source.matchAll(TOKEN_DEF)) {
		radiusTokens.set(name, value.trim());
	}
}

// Line numbers come along, because the circle allowlist is per site: naming the
// file alone would exempt every radius in it.
function declarationsIn(source) {
	// Block comments are blanked rather than deleted, so a comment spanning
	// three lines does not shift every line number after it — which is exactly
	// what an allowlist keyed on line numbers cannot survive.
	const lines = source
		.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\r\n]/g, ' '))
		.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1'));
	const out = [];
	lines.forEach((line, index) => {
		for (const match of line.matchAll(RADIUS_DECL)) {
			out.push({ value: match[1].trim(), line: index + 1 });
		}
	});
	return out;
}

function offScaleParts(declaration) {
	return declaration
		.replace(/!important/g, '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.filter(part => {
			if (SHAPES.has(part)) return false;
			const token = /^var\(--([\w-]+)\)$/.exec(part);
			if (token) {
				// A token reference is on-scale exactly when the token it names is.
				// The definitions are checked below, so this cannot be a way through.
				const value = radiusTokens.get(token[1]);
				if (value === undefined) return true;
				const tokenPx = /^(\d+(?:\.\d+)?)px$/.exec(value);
				return !(tokenPx && SCALE_PX.includes(Number(tokenPx[1])));
			}
			const px = /^(\d+(?:\.\d+)?)px$/.exec(part);
			if (px) return !SCALE_PX.includes(Number(px[1]));
			// Anything else — em, %, calc(), an unrecognised token — is off-scale
			// by construction: the point of a scale is that it is a closed set.
			return true;
		});
}

test('every shipped border-radius is on the declared scale', () => {
	const violations = [];
	for (const file of scssFiles()) {
		const relative = path.relative(repoRoot, file).split(path.sep).join('/');
		const source = fs.readFileSync(file, 'utf8');
		for (const { value, line } of declarationsIn(source)) {
			if (CIRCLES.has(`${relative}:${line}`)) {
				assert.match(value, /^(50%|100%)$/, `${relative}:${line} is allowlisted as a circle but is not one: ${value}`);
				continue;
			}
			const bad = offScaleParts(value);
			if (bad.length) violations.push(`${relative}:${line}: border-radius: ${value} (${bad.join(', ')})`);
		}
	}
	assert.deepEqual(violations, [], `off-scale radii — the scale is ${SCALE_PX.map(n => `${n}px`).join('/')}, plus 0 and 50%`);
});

test('the scan actually reaches the stylesheets it claims to', () => {
	// The four greps this replaced covered disjoint subsets, which is how fifty
	// off-scale literals survived a rule that four tests appeared to enforce.
	const files = scssFiles();
	const names = files.map(f => path.relative(repoRoot, f).split(path.sep).join('/'));

	assert.ok(files.length > 50, `expected the whole stylesheet tree, saw ${files.length} files`);
	for (const expected of [
		'lib/css/res.scss',
		'lib/options/options.scss',
		'lib/css/modules/_pageTheme.scss',
		'lib/environment/background/permissions/prompt.scss',
	]) {
		assert.ok(names.includes(expected), `${expected} is shipped and must be scanned`);
	}

	const withRadii = files.filter(f => declarationsIn(fs.readFileSync(f, 'utf8')).length);
	// And the circle allowlist still points at real declarations. An entry that
	// has drifted off its line would silently start exempting whatever moved into
	// its place.
	for (const entry of CIRCLES) {
		const [entryFile, entryLine] = entry.split(':');
		const source = fs.readFileSync(path.join(repoRoot, entryFile), 'utf8');
		const found = declarationsIn(source).find(d => d.line === Number(entryLine));
		assert.ok(found, `circle allowlist entry ${entry} does not point at a border-radius any more`);
	}
	assert.ok(withRadii.length > 20, `expected radii across the tree, found them in ${withRadii.length} files`);
});

test('the tokens define the scale and nothing beyond it', () => {
	const tokens = fs.readFileSync(path.join(libDir, 'css', '_tokens.scss'), 'utf8');
	const declared = [...tokens.matchAll(/--rsm-radius-(\w+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]);
	assert.deepEqual(declared, [
		['xs', '4px'],
		['sm', '6px'],
		['md', '8px'],
		['lg', '10px'],
		['xl', '12px'],
	], 'the token scale is the source of truth for this contract');

	// The page, the console and the permission dialog each carry their own
	// radius tokens. Three scales is a decision; three *different* scales is
	// drift, and this is the only place that would ever notice.
	assert.ok(radiusTokens.size >= 5, `expected the radius tokens to be found, saw ${radiusTokens.size}`);
	const offScale = [];
	for (const [name, value] of radiusTokens) {
		const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
		if (!px || !SCALE_PX.includes(Number(px[1]))) offScale.push(`--${name}: ${value}`);
	}
	assert.deepEqual(offScale, [], 'a radius token off the scale would let every reference to it through');
});

test('no pill radii anywhere, at any spelling', () => {
	// The grep this replaces matched the literal `999px`, so `9999px` passed.
	// Anything at or above the largest step that is not a circle is a pill.
	const offenders = [];
	for (const file of scssFiles()) {
		const relative = path.relative(repoRoot, file).split(path.sep).join('/');
		for (const { value } of declarationsIn(fs.readFileSync(file, 'utf8'))) {
			for (const part of value.split(/\s+/)) {
				const px = /^(\d+(?:\.\d+)?)px$/.exec(part);
				if (px && Number(px[1]) > Math.max(...SCALE_PX)) offenders.push(`${relative}: ${value}`);
			}
		}
	}
	assert.deepEqual(offenders, [], 'a RES-Slim control should read as browser chrome, not as a marketing button');
});
