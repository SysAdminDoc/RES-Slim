// Runs the unit suite.
//
// This exists because `yarn test` used to be a hand-maintained list of 105 file
// paths in `package.json`. A new test file ran never until someone remembered to
// append it, and nothing would have said so — the suite would just stay green
// with one fewer test in it, which is the failure mode this repo's whole testing
// effort exists to remove.
//
// The obvious fix — passing a glob to `node --test` — is worse, not better: a
// glob that matches nothing prints `tests 0` and **exits 0**. Quoting is what
// would break it, and quoting differs between the shell yarn uses on Windows and
// the one it uses elsewhere, so the failure would be silent and platform-specific.
//
// So: glob in Node, where there is no shell, and refuse to run a suite that looks
// implausibly small.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitDir = path.join(repoRoot, 'tests', 'unit');

// A floor, not the exact count — it must not need editing for every new test,
// only when the suite shrinks by a lot. Deleting a whole area of coverage should
// take a deliberate edit here.
const MINIMUM_FILES = 100;

// Every `loadModule` / `bundleEntry` call writes an esbuild bundle into
// `tests/unit/.tmp-<label>/` and nothing has ever removed them. Ninety-five had
// accumulated, and they are gitignored, so nobody saw them.
//
// That is not just untidiness. A locale-key scan reading `lib/` and `tests/` found
// `.tmp-bundle-sw-probe/background.entry.js`, which inlines the whole locale file,
// and therefore reported all 1,631 keys as used — a check reading its own build
// output, which cannot fail. Clearing them before the run means a stale bundle can
// never be read as source, and the tree does not grow.
//
// Before rather than after: after would race a suite that is still writing, and a
// crashed run would leave them behind anyway. Which is why the sweep below runs
// too — before is what makes the run correct, after is what stops the tree
// carrying a run's worth of bundles around between runs.
function sweepScratch() {
	for (const entry of fs.readdirSync(unitDir, { withFileTypes: true })) {
		if (entry.isDirectory() && entry.name.startsWith('.tmp-')) {
			fs.rmSync(path.join(unitDir, entry.name), { recursive: true, force: true });
		}
	}
}

sweepScratch();

const files = fs.readdirSync(unitDir)
	.filter(name => name.endsWith('.test.mjs'))
	.sort()
	.map(name => path.join('tests', 'unit', name));

if (files.length < MINIMUM_FILES) {
	console.error(
		`Refusing to run: found ${files.length} test files in tests/unit, expected at least ${MINIMUM_FILES}.\n` +
		'Either a lot of coverage was deleted, or this script is looking in the wrong place. ' +
		'A suite that silently runs nothing reports success.',
	);
	process.exit(1);
}

const args = ['--test', ...process.argv.slice(2), ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: repoRoot });
child.on('exit', (code, signal) => {
	// The child has exited, so nothing is still writing and the race the comment
	// above describes cannot happen. Leaving them was costing 58 MB across 175
	// directories, and a stale bundle sitting in the tree is the thing a scanner
	// reads as source.
	sweepScratch();
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
});
