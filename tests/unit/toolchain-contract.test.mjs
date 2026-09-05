// The repo declares which Node and which Yarn it builds on, and refuses the
// others before install rather than during it.
//
// `preinstall` was `node -v`, which prints a version and exits 0. Babel 8
// declares `^22.18.0 || >=24.11.0`, and `import.meta.dirname` (Node 21.2) is
// used throughout build.js, scripts/ and tests/ - so a Node below the floor got
// as far as an error from inside esbuild or Babel, about something else.
//
// Run for real against a fake `process.versions.node`, because the whole point
// is what the script decides, not which strings it contains.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

// A child Node cannot pretend to be another version, so the check runs inside
// this one with `process.versions.node` swapped out. Everything the script does
// is read-only, so importing it repeatedly is safe.
function runWith({ node = process.versions.node, agent = 'yarn/1.22.22 npm/? node/v24.19.0' } = {}) {
	return execFileSync(process.execPath, ['-e', `
		const fs = require('node:fs');
		const path = require('node:path');
		Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(node)}, configurable: true });
		process.env.npm_config_user_agent = ${JSON.stringify(agent)};
		const script = ${JSON.stringify(path.join(repoRoot, 'scripts', 'check-toolchain.mjs'))};
		import(require('node:url').pathToFileURL(script).href).catch(e => { console.error(e.message); process.exit(1); });
	`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
}

function runExpectingFailure(options) {
	try {
		runWith(options);
		return null;
	} catch (e) {
		return `${e.stdout || ''}${e.stderr || ''}`;
	}
}


// A minimal reading of the two range shapes Babel and this repo use. Enough to
// answer containment, and deliberately not a semver dependency: this file is
// checking the thing that runs before install, where there are no dependencies.
function satisfies(version, range) {
	const parts = String(version).split('.').map(Number);
	const atLeast = floor => parts[0] > floor[0] || (parts[0] === floor[0] && (parts[1] > floor[1] || (parts[1] === floor[1] && parts[2] >= floor[2])));
	return range.split('||').some(clause => {
		const caret = clause.trim().match(/^\^(\d+)\.(\d+)\.(\d+)$/);
		if (caret) { const floor = caret.slice(1).map(Number); return parts[0] === floor[0] && atLeast(floor); }
		const gte = clause.trim().match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
		if (gte) return atLeast(gte.slice(1).map(Number));
		return false;
	});
}

test('the declared range never admits a Node the compiler refuses', () => {
	// This used to assert `engines.node === babel.engines.node`. Equality was the
	// wrong relation: Babel's range is a floor, and this repo is entitled to be
	// stricter than it — which it now is, because Babel's `>=24.11.0` also admits
	// Node 25, an odd-numbered line that was never LTS and went out of security
	// support on 2026-06-01. What has to hold is containment, so drift in either
	// direction is still caught: anything this repo accepts, Babel must accept.
	const babel = JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules', '@babel', 'core', 'package.json'), 'utf8'));
	assert.ok(babel.engines && babel.engines.node, 'Babel stopped declaring a Node range; the floor has to come from somewhere');

	for (const version of ['22.18.0', '22.30.0', '24.11.0', '24.19.0', '26.0.0', '27.5.0']) {
		assert.match(runWith({ node: version }), /toolchain ok/, `Node ${version} is on a supported line`);
		assert.ok(
			satisfies(version, babel.engines.node),
			`this repo accepts Node ${version} but Babel ${babel.version} declares ${babel.engines.node}`,
		);
	}

	assert.equal(pkg.packageManager, 'yarn@1.22.22');
	assert.equal(pkg.scripts.preinstall, 'node scripts/check-toolchain.mjs');
});

test('an unsupported Node is refused, with something to do about it', () => {
	// 25 is here rather than in the accepted list on purpose: odd majors are never
	// LTS, and this one stopped receiving security fixes on 2026-06-01. Babel
	// would take it; this repo does not.
	for (const version of ['20.19.0', '22.17.9', '24.10.0', '23.11.0', '25.0.0', '25.9.9']) {
		const output = runExpectingFailure({ node: version });
		assert.ok(output, `Node ${version} should not have been accepted`);
		assert.match(output, new RegExp(`Node ${version.replace(/\./g, '\\.')} cannot build this repo`));
		assert.match(output, /nodejs\.org/, 'a refusal with no next step is a dead end');
	}
});

test('a Yarn that is not the pinned one is refused, and Yarn 2 says why that matters', () => {
	const two = runExpectingFailure({ agent: 'yarn/4.1.0 npm/? node/v24.19.0' });
	assert.ok(two, 'Yarn 4 should not have been accepted');
	assert.match(two, /not the version this repo is pinned to \(1\.22\.22\)/);
	assert.match(two, /Yarn 1 format/);

	const olderOne = runExpectingFailure({ agent: 'yarn/1.22.19 npm/? node/v24.19.0' });
	assert.ok(olderOne, 'an unpinned Yarn 1 should still be reported');
	assert.match(olderOne, /the pin exists so a lockfile change is deliberate/);
});

test('npm running the script is not mistaken for an unpinned yarn', () => {
	// `npm install` sets a user agent with no yarn in it. Reporting "yarn is
	// missing" there would be noise about the wrong thing.
	assert.match(runWith({ agent: 'npm/10.9.0 node/v24.19.0' }), /toolchain ok/);
});
