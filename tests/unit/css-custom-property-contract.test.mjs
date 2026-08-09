import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function collectScss(dir, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectScss(full, found);
		else if (entry.name.endsWith('.scss')) found.push(full);
	}
	return found;
}

// `var(--a)` is a hard dependency on --a existing; `var(--a, fallback)` is not,
// because the fallback renders when nothing defines it. Splitting the two needs
// the closing paren, not a regex — `var(--a, var(--b))` nests, and a top-level
// comma is the only thing that distinguishes the two forms.
export function readVarReferences(source) {
	const references = [];
	for (let i = source.indexOf('var('); i !== -1; i = source.indexOf('var(', i + 1)) {
		const nameMatch = /^var\(\s*(--[A-Za-z0-9_-]+)/.exec(source.slice(i));
		if (!nameMatch) continue;

		let depth = 0;
		let hasFallback = false;
		for (let j = i + 3; j < source.length; j++) {
			const char = source[j];
			if (char === '(') depth++;
			else if (char === ')') {
				depth--;
				if (depth === 0) break;
			} else if (char === ',' && depth === 1) {
				hasFallback = true;
			}
		}
		references.push({ name: nameMatch[1], hasFallback });
	}
	return references;
}

export function readVarDefinitions(source) {
	return [...source.matchAll(/^[^\S\n]*(--[A-Za-z0-9_-]+)\s*:/gm)].map(match => match[1]);
}

// Two properties are written from JS rather than declared in any stylesheet, so
// a stylesheet is allowed to read them without a fallback.
const SET_FROM_JS = new Set(['--prompt-accent', '--rsm-th-accent']);

test('the var() reference parser separates fallbacks from hard dependencies', () => {
	// Bait: if this ever reads `var(--a, red)` as a hard dependency, or misses
	// the nested reference, the scan below stops meaning what it claims.
	assert.deepEqual(readVarReferences('color: var(--a);'), [{ name: '--a', hasFallback: false }]);
	assert.deepEqual(readVarReferences('color: var(--a, red);'), [{ name: '--a', hasFallback: true }]);
	assert.deepEqual(readVarReferences('color: var(--a, var(--b));'), [
		{ name: '--a', hasFallback: true },
		{ name: '--b', hasFallback: false },
	]);
	assert.deepEqual(readVarReferences('color: color-mix(in srgb, var(--a) 10%, transparent);'), [
		{ name: '--a', hasFallback: false },
	]);

	assert.deepEqual(readVarDefinitions('\t--a: 1px;\n\t--b:2px;'), ['--a', '--b']);
	// A reference is not a definition, however the line is indented.
	assert.deepEqual(readVarDefinitions('\tfont: 11px var(--a);'), []);
});

test('every custom property read without a fallback is defined somewhere', () => {
	const files = collectScss(path.join(repoRoot, 'lib'));
	assert.ok(files.length > 40, `expected the SCSS tree, found ${files.length} files`);

	const defined = new Set(SET_FROM_JS);
	const required = new Map();

	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		const relative = path.relative(repoRoot, file).split(path.sep).join('/');
		for (const name of readVarDefinitions(source)) defined.add(name);
		for (const { name, hasFallback } of readVarReferences(source)) {
			if (hasFallback) continue;
			if (!required.has(name)) required.set(name, new Set());
			required.get(name).add(relative);
		}
	}

	// The scan is worthless if it found nothing to check.
	assert.ok(required.size > 50, `expected the token system, found ${required.size} references`);

	const undefinedTokens = [...required]
		.filter(([name]) => !defined.has(name))
		.map(([name, users]) => `${name} (read by ${[...users].sort().join(', ')})`);

	// v0.29.0 shipped `font: 11px/1.45 var(--options-font-mono)` with no such
	// token anywhere. An undefined property with no fallback makes the whole
	// declaration invalid at computed-value time, and `font` is inherited, so
	// the module error log rendered in the console's 13px Segoe UI rather than
	// the 11px monospace it asks for. Nothing warns; the rule just does nothing.
	assert.deepEqual(undefinedTokens, [], `undefined custom properties:\n  ${undefinedTokens.join('\n  ')}`);
});
