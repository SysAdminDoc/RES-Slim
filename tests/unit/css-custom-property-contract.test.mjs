import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function collectFiles(dir, extension, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectFiles(full, extension, found);
		else if (entry.name.endsWith(extension)) found.push(full);
	}
	return found;
}

const collectScss = dir => collectFiles(dir, '.scss');
// Blind spot: the scan read `.scss` only, while JS injects stylesheets too. It
// turns out to be two files rather than the sixteen the roadmap estimated — the
// other injection sites write literal values — but two unchecked references are
// still two more than the contract claimed to allow.
const collectJs = dir => collectFiles(dir, '.js');

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

// The three directions this contract used to be blind in. Each is a way for a
// token to be wrong that "every hard reference is defined somewhere" cannot see.

// A token is defined either by a declaration in SCSS or by JS writing it onto an
// element. The second is easy to miss: `--rsm-overlay-dim` and
// `--rsm-th-header-height` exist only because a module calls setProperty, and
// `ACCENT_PROPERTIES` is an array of names applied in a loop, so matching only
// `setProperty('--x'` would miss three more.
export function readJsDefinitions(source) {
	return [...source.matchAll(/['"`](--[A-Za-z][A-Za-z0-9_-]*)['"`]/g)].map(match => match[1]);
}

function everyDefinition() {
	const defined = new Set(SET_FROM_JS);
	for (const file of collectScss(path.join(repoRoot, 'lib'))) {
		for (const name of readVarDefinitions(fs.readFileSync(file, 'utf8'))) defined.add(name);
	}
	for (const file of collectJs(path.join(repoRoot, 'lib'))) {
		for (const name of readJsDefinitions(fs.readFileSync(file, 'utf8'))) defined.add(name);
	}
	return defined;
}

function everyReference({ includeFallbacks }) {
	const used = new Map();
	const record = (name, where) => {
		if (!used.has(name)) used.set(name, new Set());
		used.get(name).add(where);
	};
	for (const file of [...collectScss(path.join(repoRoot, 'lib')), ...collectJs(path.join(repoRoot, 'lib'))]) {
		const source = fs.readFileSync(file, 'utf8');
		const relative = path.relative(repoRoot, file).split(path.sep).join('/');
		for (const { name, hasFallback } of readVarReferences(source)) {
			if (hasFallback && !includeFallbacks) continue;
			record(name, relative);
		}
		// A token JS writes is a token in use, even when no stylesheet reads it back.
		if (file.endsWith('.js')) {
			for (const name of readJsDefinitions(source)) record(name, relative);
		}
	}
	return used;
}

test('a reference carrying a fallback still names a token that exists', () => {
	// `var(--typo, 12px)` renders the fallback forever and never complains, so a
	// misspelled token hides behind a plausible result. The fallback is a
	// resilience measure, not a licence to name something that is not there.
	const defined = everyDefinition();
	const referenced = everyReference({ includeFallbacks: true });
	assert.ok(referenced.size > 60, `expected the token system, found ${referenced.size} references`);

	const missing = [...referenced]
		.filter(([name]) => !defined.has(name))
		// Tokens a standalone exported document defines for itself, not part of the
		// extension's own system.
		.filter(([name]) => name !== '--d')
		.map(([name, users]) => `${name} (read by ${[...users].sort().join(', ')})`);
	assert.deepEqual(missing, [], `undefined tokens behind a fallback:\n  ${missing.join('\n  ')}`);
});

// Tokens nothing currently reads, each kept on purpose. Every one completes a
// scale or a family whose other members are live, so deleting it would leave a
// vocabulary with a hole in it — a five-step radius scale missing two steps, a
// status family with `soft` but no `line`. The next author would then invent a
// replacement rather than find the gap.
//
// This is a reviewed list, not an amnesty: each entry is asserted below to still
// exist and still be unused, so adopting one without removing its entry fails,
// and so does deleting one and leaving the entry behind.
const DELIBERATELY_UNREFERENCED = new Map([
	['--rsm-radius-lg', 'radius scale step 10px; radius-scale-contract enumerates 4/6/8/10/12'],
	['--rsm-radius-xl', 'radius scale step 12px, the top of that same scale'],
	['--rsm-motion-slow', 'motion scale, alongside --rsm-motion-fast and --rsm-motion'],
	['--rsm-success-line', 'status family: base/text/soft/line, and every other line token is used'],
	['--rsm-warning-line', 'status family, as above'],
	['--rsm-info-soft', 'status family: every other soft token is used'],
	['--rsm-surface-sunken', 'surface family: surface / raised / sunken / panel'],
	['--rsm-scrim', 'the shared overlay scrim; overlayViewer paints its own ::backdrop now'],
	['--prompt-border-strong', 'pairs with --prompt-border, which is used five times'],
	['--prompt-warning', 'status trio in the permission prompt: success / warning / danger'],
	['--options-danger', 'status trio in the console: success / warning / danger'],
	['--options-shadow', 'pairs with --options-shadow-soft; both are zeroed under forced colours'],
]);

// These names belong to Reddit's Web3X design system. RES-Slim defines them on
// <html> so native components, including controls inside shadow roots, inherit
// the selected palette. They are intentionally consumed by Reddit rather than
// referenced by another declaration in this repository.
const SHREDDIT_INHERITED_TOKENS = new Set([
	'--color-neutral-background',
	'--color-neutral-background-hover',
	'--color-neutral-background-selected',
	'--color-neutral-background-strong',
	'--color-neutral-background-weak',
	'--color-neutral-border',
	'--color-neutral-border-strong',
	'--color-neutral-border-weak',
	'--color-neutral-content',
	'--color-neutral-content-strong',
	'--color-neutral-content-weak',
	'--color-primary',
	'--color-primary-background',
	'--color-primary-background-hover',
	'--color-primary-content',
	'--color-secondary-background',
	'--color-secondary-background-hover',
	'--color-secondary-content',
	'--page-y-padding',
	'--shreddit-content-background',
	'--shreddit-header-height',
	'--shreddit-color-wordmark',
]);

test('every defined token is referenced, or is a listed member of a live set', () => {
	// The other direction, which the one-way scan could never see. A token nothing
	// reads is not inert: it is a name the next reader assumes is load-bearing, and
	// a value that quietly diverges from the live ones beside it.
	const referenced = everyReference({ includeFallbacks: true });
	const defined = new Map();
	for (const file of collectScss(path.join(repoRoot, 'lib'))) {
		const relative = path.relative(repoRoot, file).split(path.sep).join('/');
		for (const name of new Set(readVarDefinitions(fs.readFileSync(file, 'utf8')))) {
			if (!defined.has(name)) defined.set(name, relative);
		}
	}

	const unused = [...defined].filter(([name]) => !referenced.has(name));
	const unlisted = unused
		.filter(([name]) => !DELIBERATELY_UNREFERENCED.has(name))
		.filter(([name]) => !SHREDDIT_INHERITED_TOKENS.has(name))
		.map(([name, file]) => `${name} (defined in ${file})`);
	assert.deepEqual(unlisted.sort(), [],
		`tokens nothing reads, and nothing explains:\n  ${unlisted.join('\n  ')}`);

	// A stale entry is the failure mode of every allowlist. Both directions.
	const unusedNames = new Set(unused.map(([name]) => name));
	const stale = [...DELIBERATELY_UNREFERENCED.keys()].filter(name => !unusedNames.has(name)).map(name =>
		defined.has(name) ?
			`${name} is referenced now — drop it from the list` :
			`${name} no longer exists — drop it from the list`);
	assert.deepEqual(stale, [], `the deliberately-unreferenced list has drifted:\n  ${stale.join('\n  ')}`);
	const staleShreddit = [...SHREDDIT_INHERITED_TOKENS].filter(name => !unusedNames.has(name));
	assert.deepEqual(staleShreddit, [], `the inherited Shreddit token list has drifted:\n  ${staleShreddit.join('\n  ')}`);

	// A ceiling, so the list cannot absorb a growing pile one entry at a time.
	assert.ok(DELIBERATELY_UNREFERENCED.size <= 12,
		`${DELIBERATELY_UNREFERENCED.size} unreferenced tokens is no longer a set of deliberate gaps`);
});

test('every theme scope defines the same set of tokens', () => {
	// A definition inside one `[data-settings-theme]` block satisfies the
	// one-direction scan for references in the other eight, so a token missing
	// from a single theme reads as covered. What actually happens is that the
	// property is undefined in that theme only, which is the hardest kind of
	// visual bug to attribute.
	const source = fs.readFileSync(path.join(repoRoot, 'lib/options/options.scss'), 'utf8');
	const scopes = new Map();
	const spans = [];
	const blockPattern = /\[data-settings-theme=['"]?([a-z-]+)['"]?\]\s*\{/g;
	for (const match of source.matchAll(blockPattern)) {
		// Walk to the matching close brace so nested rules stay with their scope.
		let depth = 1;
		let i = match.index + match[0].length;
		for (; i < source.length && depth > 0; i++) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}') depth--;
		}
		spans.push([match.index, i]);
		const body = source.slice(match.index + match[0].length, i);
		const names = scopes.get(match[1]) || new Set();
		for (const name of readVarDefinitions(body)) names.add(name);
		scopes.set(match[1], names);
	}

	assert.ok(scopes.size >= 2, `expected the settings themes, found ${scopes.size} scopes`);

	// Everything defined outside a theme scope. A token only some themes restate is
	// fine when one of these stands behind it: `paper` is the sole light theme, so
	// it alone restates the status colours and shadows while the seven dark themes
	// correctly inherit the defaults. What is not fine is a token that exists in
	// one theme scope and nowhere else, because every other theme then resolves it
	// to nothing at all — and the one-direction scan calls that covered, because
	// the token *is* defined, just never where it is read.
	let outside = '';
	let cursor = 0;
	for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
		outside += source.slice(cursor, start);
		cursor = end;
	}
	outside += source.slice(cursor);
	const base = new Set(readVarDefinitions(outside));
	for (const name of readVarDefinitions(fs.readFileSync(path.join(repoRoot, 'lib/css/_tokens.scss'), 'utf8'))) base.add(name);

	const union = new Set([...scopes.values()].flatMap(set => [...set]));
	const gaps = [];
	for (const name of union) {
		if (base.has(name)) continue;
		for (const [theme, names] of scopes) {
			if (!names.has(name)) gaps.push(`${theme} does not define ${name}, and nothing outside the theme scopes does either`);
		}
	}
	assert.deepEqual(gaps.sort(), [], `theme scopes disagree:\n  ${gaps.join('\n  ')}`);
});
