// Runs the ten behavioural specs in `lib/utils/__tests__/`.
//
// They were written for ava, which is not installed — `ava.config.mjs` also
// pointed at `dist/transpiled/**`, a path nothing produces — so none of them had
// ever executed. That is a false sense of coverage and dead weight at once.
//
// Rather than hand-rewrite ~800 lines of good assertions, this adapts them: a
// small shim supplies ava's `test(name, t => …)` surface on top of `node --test`,
// and `lib/utils` plus `lib/core` are mirrored to a temp directory **at their
// real relative depth**, Flow stripped, so the specs' own relative imports
// resolve without rewriting them.
//
// A spec that cannot load is reported as a failure rather than skipped. Silently
// passing over one is how these ten went unrun for a year.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const libDir = path.join(repoRoot, 'lib');
const tmpRoot = path.join(repoRoot, 'tests', 'unit', '.tmp-utils-specs');

fs.rmSync(tmpRoot, { recursive: true, force: true });

// esbuild resolves extensionless relative specifiers; node does not, so the
// mirrored copies need them spelled out.
const addExtensions = src => src
	.replace(/from '(\.\.?\/[\w./-]+)'/g, (whole, spec) => (path.extname(spec) ? whole : `from '${spec}.js'`));

// Mirror one directory of `lib` into the temp tree, keeping its path so relative
// imports between mirrored files keep working.
function mirror(relDir) {
	const from = path.join(libDir, relDir);
	const to = path.join(tmpRoot, relDir);
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
		const source = fs.readFileSync(path.join(from, entry.name), 'utf8');
		try {
			fs.writeFileSync(path.join(to, entry.name), addExtensions(flowRemoveTypes(source, { all: true }).toString()));
		} catch (e) {
			// Unparseable standalone; any spec depending on it reports below.
		}
	}
}

mirror('utils');
mirror('core/dom');

// ava's assertion surface, as these specs use it, mapped onto node:assert.
fs.writeFileSync(path.join(tmpRoot, '__ava_shim.mjs'), `import assert from 'node:assert/strict';

function matchMessage(error, expected, message) {
	if (!expected || expected.message === undefined) return;
	// ava accepts either a string or a RegExp here, and these specs use both.
	if (expected.message instanceof RegExp) assert.match(error.message, expected.message, message);
	else assert.strictEqual(error.message, expected.message, message);
}

export function makeT() {
	return {
		is: (a, b, m) => assert.strictEqual(a, b, m),
		not: (a, b, m) => assert.notStrictEqual(a, b, m),
		deepEqual: (a, b, m) => assert.deepStrictEqual(a, b, m),
		notDeepEqual: (a, b, m) => assert.notDeepStrictEqual(a, b, m),
		true: (a, m) => assert.strictEqual(a, true, m),
		false: (a, m) => assert.strictEqual(a, false, m),
		truthy: (a, m) => assert.ok(a, m),
		falsy: (a, m) => assert.ok(!a, m),
		pass: () => assert.ok(true),
		fail: m => assert.fail(m || 't.fail()'),
		throws: (fn, expected, m) => {
			try {
				fn();
			} catch (e) {
				matchMessage(e, expected, m);
				return e;
			}
			assert.fail(m || 'expected the function to throw');
			return undefined;
		},
		notThrows: (fn, m) => { assert.doesNotThrow(fn, m); },
		// ava's async variants take a promise rather than a thunk, and resolve to
		// the error so the caller can assert further on it.
		throwsAsync: async (promise, expected, m) => {
			try {
				await (typeof promise === 'function' ? promise() : promise);
			} catch (e) {
				matchMessage(e, expected, m);
				return e;
			}
			assert.fail(m || 'expected the promise to reject');
			return undefined;
		},
		notThrowsAsync: async (promise, m) => {
			await (typeof promise === 'function' ? promise() : promise);
			assert.ok(true, m);
		},
		regex: (value, re, m) => assert.match(value, re, m),
		plan: () => {},
	};
}
`);

const specDir = path.join(libDir, 'utils', '__tests__');
const specFiles = fs.readdirSync(specDir).filter(f => f.endsWith('.js')).sort();
assert.ok(specFiles.length >= 10, `expected the ten util specs, found ${specFiles.length}`);

const mirroredSpecDir = path.join(tmpRoot, 'utils', '__tests__');
fs.mkdirSync(mirroredSpecDir, { recursive: true });

for (const file of specFiles) {
	const source = fs.readFileSync(path.join(specDir, file), 'utf8');
	const stripped = addExtensions(flowRemoveTypes(source, { all: true }).toString())
		// ava supports test macros — `test(title, implementation, ...args)` — and
		// location.js uses them for every case, so the trailing arguments must be
		// forwarded or the implementation runs with undefined inputs.
		.replace(
			/import\s+test\s+from\s+'ava';?/,
			"import { makeT } from '../../__ava_shim.mjs';\nconst test = (name, fn, ...args) => globalThis.__collect(name, fn, makeT, args);",
		);
	fs.writeFileSync(path.join(mirroredSpecDir, file), stripped);
}

const collected = [];
globalThis.__collect = (name, fn, makeT, args = []) => { collected.push({ name, fn, makeT, args }); };

for (const file of specFiles) {
	const before = collected.length;
	let importError = null;
	try {
		// eslint-disable-next-line no-await-in-loop
		await import(pathToFileURL(path.join(mirroredSpecDir, file)).href);
	} catch (e) {
		importError = e;
	}
	const cases = collected.slice(before);

	if (importError) {
		test(`lib/utils/__tests__/${file} loads`, () => {
			assert.fail(`could not run: ${importError.message}`);
		});
		continue;
	}

	test(`lib/utils/__tests__/${file} declares cases`, () => {
		assert.ok(cases.length > 0, `${file} registered no test cases`);
	});

	for (const { name, fn, makeT, args } of cases) {
		test(`${file.replace('.js', '')}: ${name}`, async () => {
			await fn(makeT(), ...args);
		});
	}
}
