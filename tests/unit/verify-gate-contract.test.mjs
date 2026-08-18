// `yarn verify` is the only thing that runs every gate together. Its value comes
// entirely from being complete, so the failure mode to guard is a gate that
// exists in package.json and is never reached — which is the exact state the
// repo was in before verify existed: lint, flow, e2e and check:endpoints were all
// defined and none of them ran unless somebody remembered.
//
// This asserts the two lists agree, so adding a gate script without adding it to
// GATES fails here rather than silently narrowing what a push checks.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const verifySource = read('scripts/verify.mjs');

// Scripts that are gates: they assert something and are meant to fail a push.
// Everything else in package.json is a dev affordance (start, once, watch) or a
// narrower slice of a gate already covered (test:settings, test:privacy), or an
// explicit baseline-rewriting escape hatch (lint:baseline, flow:baseline).
const GATE_SCRIPTS = ['lint', 'flow', 'test', 'build', 'test:e2e', 'check:endpoints'];

// Slices of `test` that exist for focused runs. Listing them explicitly means a
// genuinely new script cannot hide in this exemption.
const NON_GATE_SCRIPTS = new Set([
	'preinstall', 'prestart', 'start', 'preonce', 'once', 'prebuild',
	'test:settings', 'test:show-images', 'test:privacy', 'pretest:e2e',
	'eslint', 'stylelint', 'lint:i18n', 'flow:baseline', 'lint:baseline',
	'test:bundle', 'fixture:import', 'verify', 'bundle:baseline',
]);

function declaredGates() {
	// Read the `script:` field of every GATES entry in verify.mjs.
	return [...verifySource.matchAll(/script:\s*'([^']+)'/g)].map(m => m[1]);
}

test('verify runs every gate script', () => {
	const declared = declaredGates();

	assert.ok(declared.length > 0, 'sanity: verify.mjs must declare gates');
	for (const script of GATE_SCRIPTS) {
		assert.ok(
			declared.includes(script),
			`verify.mjs does not run "${script}" — a gate that nothing invokes is not a gate`,
		);
	}
});

test('every gate verify runs is a real package.json script', () => {
	for (const script of declaredGates()) {
		assert.ok(
			Object.hasOwn(pkg.scripts, script),
			`verify.mjs runs "${script}", which package.json does not define`,
		);
	}
});

test('no package.json script escapes classification', () => {
	// Forces a decision when a script is added: either it is a gate verify must
	// run, or it is explicitly exempt. Silence is not an option.
	const classified = new Set([...GATE_SCRIPTS, ...NON_GATE_SCRIPTS]);

	for (const script of Object.keys(pkg.scripts)) {
		assert.ok(
			classified.has(script),
			`package.json script "${script}" is neither a declared gate nor listed as a non-gate — decide which it is in tests/unit/verify-gate-contract.test.mjs`,
		);
	}
});

test('verify stops at the first failure rather than running on', () => {
	// The summary is only trustworthy if a later "pass" cannot appear after an
	// earlier failure.
	assert.match(verifySource, /if\s*\(code !== 0\)\s*\{[\s\S]*?break;/);
});
