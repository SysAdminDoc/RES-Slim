// One command that runs every gate this repo has, in order, and stops at the
// first failure.
//
//   yarn verify                 # everything, including the network probe
//   yarn verify --skip-network  # everything local (no third-party requests)
//
// Why this exists: the gates were all present and none of them ran together.
// `yarn test` invokes only the unit suite, there were no git hooks, there is no
// CI by charter, and nothing referenced `check:endpoints` at all — so lint, Flow,
// e2e and the endpoint probe each ran only when somebody remembered. That is how
// a dead third-party default sat undetected through three releases, and how six
// versions shipped without a tag. A gate nobody invokes is not a gate.
//
// Ordering is cheapest-first so a typo fails in seconds rather than after a
// build: lint and Flow are static, the unit suite needs no browser, the build
// must succeed before e2e can load it, and the network probe runs last because
// it is the only step that can fail for reasons outside this repository.

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skipNetwork = process.argv.includes('--skip-network');

const GATES = [
	{ name: 'lint', script: 'lint', why: 'eslint baseline, stylelint, i18n keys' },
	{ name: 'flow', script: 'flow', why: 'Flow baseline' },
	{ name: 'test', script: 'test', why: 'unit suite' },
	{ name: 'build', script: 'build', why: 'production Chrome + Firefox bundles and zips' },
	{ name: 'e2e', script: 'test:e2e', why: 'built extension driven in headless Chromium' },
	{ name: 'endpoints', script: 'check:endpoints', why: 'third-party defaults still answer', network: true },
	// Reports, never fails. The published repo description is the copy the public
	// reads, and it drifted from the README for months while a contract asserted
	// the README's half — but this needs a network and a `gh` login, neither of
	// which is a property of the code, and a gate that goes red because someone is
	// offline stops being read.
	{ name: 'metadata', script: 'check:metadata', why: 'the published repo description still matches the README', network: true, advisory: true },
];

function run(gate) {
	// `yarn <script>` rather than the underlying command so the definition stays
	// in package.json and cannot drift from what a human would type.
	//
	// A shell is unavoidable on Windows, where yarn is `yarn.cmd` and Node has
	// refused to spawn `.cmd` without one since the CVE-2024-27980 fix. Passing
	// the whole invocation as one string rather than a command plus an args array
	// is what keeps Node from emitting DEP0190 — that warning is about arguments
	// being concatenated instead of escaped, which cannot bite here because every
	// script name is a hardcoded constant in GATES.
	const started = Date.now();
	const result = spawnSync(`yarn ${gate.script}`, {
		cwd: repoRoot,
		stdio: 'inherit',
		shell: true,
	});
	return { code: result.status == null ? 1 : result.status, ms: Date.now() - started };
}

const summary = [];
let failed = null;

for (const gate of GATES) {
	if (gate.network && skipNetwork) {
		summary.push({ name: gate.name, state: 'skip', ms: 0 });
		continue;
	}

	console.log(`\n=== verify: ${gate.name} — ${gate.why} ===`);
	const { code, ms } = run(gate);
	const state = code === 0 ? 'pass' : (gate.advisory ? 'warn' : 'FAIL');
	summary.push({ name: gate.name, state, ms });

	if (code !== 0 && !gate.advisory) {
		failed = gate;
		break;
	}
}

console.log('\n=== verify summary ===');
for (const row of summary) {
	const seconds = row.state === 'skip' ? '' : `${(row.ms / 1000).toFixed(1)}s`;
	console.log(`  ${row.state.padEnd(4)}  ${row.name.padEnd(10)} ${seconds}`);
}

if (failed) {
	const remaining = GATES.length - summary.length;
	console.log(`\n${failed.name} failed — ${remaining} later gate(s) not run.`);
	process.exit(1);
}

if (skipNetwork) {
	console.log('\nAll local gates passed. Run `yarn verify` without --skip-network before a release.');
} else {
	console.log('\nAll gates passed.');
}
