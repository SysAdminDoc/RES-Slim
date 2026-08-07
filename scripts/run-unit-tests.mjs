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
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
});
