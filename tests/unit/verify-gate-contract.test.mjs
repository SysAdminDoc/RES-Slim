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
const GATE_SCRIPTS = ['lint', 'flow', 'test', 'build', 'test:e2e', 'check:endpoints', 'check:metadata'];

// Gates that report rather than fail. `check:metadata` compares the published
// GitHub description against the README, which needs a network and a `gh` login
// — neither of which is a property of the code, and a gate that goes red because
// someone is offline stops being read. It still has to be *run*, which is the
// whole point of the list above.
const ADVISORY_SCRIPTS = new Set(['check:metadata']);

// Slices of `test` that exist for focused runs. Listing them explicitly means a
// genuinely new script cannot hide in this exemption.
const NON_GATE_SCRIPTS = new Set([
	'preinstall', 'prestart', 'start', 'preonce', 'once', 'prebuild',
	'test:settings', 'test:show-images', 'test:privacy', 'pretest:e2e',
	'eslint', 'stylelint', 'lint:i18n', 'flow:baseline', 'lint:baseline',
	'test:bundle', 'fixture:import', 'verify', 'bundle:baseline',
	// Writes a version, a commit and a tag. Deliberately operator-run: a gate
	// must be safe to run on every push, and this is not.
	'release',
	// Pushes, uploads, and creates a GitHub release. More operator-run than
	// `release`: it needs a `gh` login and a network, it makes changes nobody can
	// take back, and it runs the whole `verify` chain itself as its first step.
	'publish:release',
	// Rewrites the two shipped manifests from `manifest.config.js`, so it is a
	// writer like `lint:baseline`, not a check. Its `--check` twin is here rather
	// than in the gate list because `manifest-generation-contract` asserts the
	// same thing from inside the `test` gate, and a second gate running the same
	// comparison buys nothing but a slower push.
	'manifest', 'manifest:check',
	// Drives the built MV2 add-on in a real Firefox over WebDriver BiDi. Needs a
	// system Firefox the repo does not install, and a gate that cannot run on a
	// clean checkout is a gate that gets skipped rather than fixed. Operator-run
	// before a release, or after anything touching the manifest or the page-world
	// injection.
	'firefox:audit',
	// Attaches to a browser a person started and measures the classic layout on
	// whatever live reddit page is open in it. It cannot be a gate for the reason
	// the layout keeps regressing in the first place: live current Reddit refuses
	// an automated profile, so this needs a real signed-in session and the
	// internet. Operator-run after anything that touches the classic layout.
	'live-probe',
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
	// earlier failure. Advisory gates are the one exception, and the exception has
	// to be written into the condition rather than into a comment.
	assert.match(verifySource, /if\s*\(code !== 0 && !gate\.advisory\)\s*\{[\s\S]*?break;/);
});

test('every advisory gate is declared advisory in verify.mjs, and no others are', () => {
	// An advisory gate that forgot its flag would fail a push over someone's
	// network; a failing gate that gained the flag would stop failing pushes at
	// all, quietly. Both are one word, so both are asserted.
	const entries = [...verifySource.matchAll(/\{ name: '([^']+)', script: '([^']+)'[^}]*\}/g)];
	assert.ok(entries.length >= GATE_SCRIPTS.length, 'sanity: every gate should parse out of verify.mjs');

	for (const [entry, , script] of entries) {
		const isAdvisory = /advisory:\s*true/.test(entry);
		assert.equal(
			isAdvisory,
			ADVISORY_SCRIPTS.has(script),
			isAdvisory ?
				`"${script}" is marked advisory in verify.mjs but is not listed as one here — a gate that cannot fail a push should be a deliberate decision` :
				`"${script}" is listed as advisory here but verify.mjs will fail a push on it`,
		);
	}
});
