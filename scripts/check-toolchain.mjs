// Refuse an install on a runtime this repo does not build on.
//
// `preinstall` was `node -v`: it printed the version and exited 0, so a Node
// that cannot run the build got as far as a confusing failure somewhere inside
// esbuild or Babel. Babel 8 declares `^22.18.0 || >=24.11.0` and this repo uses
// `import.meta.dirname` (Node 21.2+) throughout `build.js`, `scripts/` and
// `tests/`, so the floor is real rather than aspirational.
//
// `engines.node` is narrower than Babel's floor on purpose, and each clause is a
// line rather than a number. Dates from https://endoflife.date/nodejs, read
// 2026-09-05:
//
//   ^22.18.0  Maintenance LTS since 2025-10-21, ends 2027-04-30.
//   ^24.11.0  Active LTS, ends 2026-10-20, then maintenance to 2028-04-30.
//   >=26.0.0  Current since 2026-05-05, Active LTS to 2027-10-27.
//
// The gap in the middle is the point. Babel's `>=24.11.0` also admits Node 25,
// which is an odd-numbered line that was never LTS and went out of security
// support on 2026-06-01 — so the old range let this repo be built on a runtime
// that stopped receiving fixes three months ago. Odd majors are never LTS; the
// next decision here is Node 28, and the trigger for making it is 24 leaving
// maintenance rather than 26 shipping.
//
// Yarn is pinned too, and to Yarn 1: `yarn.lock` is the v1 format, and every
// script here is written against v1's CLI. Yarn 2+ reads that lockfile and
// silently converts it.
//
// Deliberately dependency-free and run before install, which is the only moment
// it can still say something useful.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
// `execSync`, not `execFileSync` with `shell: true`: on Windows yarn is a .cmd
// and needs a shell either way, and passing an args array through one is what
// Node deprecated in DEP0190. The command is a fixed literal.
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function parse(version) {
	const match = String(version).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	const [, major, minor, patch] = match;
	return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

function atLeast(actual, floor) {
	if (actual.major !== floor.major) return actual.major > floor.major;
	if (actual.minor !== floor.minor) return actual.minor > floor.minor;
	return actual.patch >= floor.patch;
}

// `engines.node` is the source of truth; this reads the two ranges out of it
// rather than restating them, so the declaration and the check cannot drift.
function nodeIsSupported(actual, range) {
	return range.split('||').some(part => {
		const caret = part.trim().match(/^\^(\d+\.\d+\.\d+)$/);
		if (caret) {
			const floor = parse(caret[1]);
			return actual.major === floor.major && atLeast(actual, floor);
		}
		const gte = part.trim().match(/^>=\s*(\d+\.\d+\.\d+)$/);
		if (gte) return atLeast(actual, parse(gte[1]));
		return false;
	});
}

const failures = [];

const node = parse(process.versions.node);
if (!node || !nodeIsSupported(node, pkg.engines.node)) {
	failures.push([
		`Node ${process.versions.node} cannot build this repo.`,
		`  Needed: ${pkg.engines.node} (Babel 8's floor, and \`import.meta.dirname\` is used throughout the build and the tests).`,
		'  Install a supported Node - https://nodejs.org/en/download - and run `yarn install` again.',
	].join('\n'));
}

// Yarn's version is not in `process.versions`, and `npm_config_user_agent` is
// only set when yarn is the thing running this. Asking the binary is the
// fallback for a direct `node scripts/check-toolchain.mjs`.
function yarnVersion() {
	const agent = process.env.npm_config_user_agent || '';
	const fromAgent = agent.match(/yarn\/(\d+\.\d+\.\d+)/);
	if (fromAgent) return fromAgent[1];
	if (/npm\/\d/.test(agent)) return null; // npm ran this, not yarn
	try {
		return String(execSync('yarn --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
	} catch (e) {
		return null;
	}
}

const pinned = String(pkg.packageManager).split('@')[1];
const yarn = yarnVersion();
if (yarn && yarn !== pinned) {
	const major = Number(yarn.split('.')[0]);
	failures.push([
		`Yarn ${yarn} is not the version this repo is pinned to (${pinned}).`,
		major >= 2 ?
			'  yarn.lock is the Yarn 1 format and every script here is written against the Yarn 1 CLI. Yarn 2+ rewrites that lockfile on install.' :
			'  A different Yarn 1 patch is usually fine; the pin exists so a lockfile change is deliberate.',
		`  \`npm install --global yarn@${pinned}\`, or run with \`corepack yarn@${pinned}\`.`,
	].join('\n'));
}

if (failures.length) {
	console.error(`\n${failures.join('\n\n')}\n`);
	process.exit(1);
}

console.log(`toolchain ok: node ${process.versions.node}${yarn ? `, yarn ${yarn}` : ''}`);
