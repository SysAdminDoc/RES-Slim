// Runs Flow and holds its error count to a committed per-file baseline.
//
// Flow had been installed and never invoked. `package.json` had no script, there
// is no CI, and a roadmap item concluded that the checker "cannot parse what the
// build strips" because `flow-bin` (0.84.0, 2018) is 162 minor versions behind
// `flow-remove-types`. That turned out to be wrong: it parses the whole tree
// cleanly — zero unreadable files across 405 annotated files — and reported 197
// type errors, 177 once the libdefs for five libraries this fork no longer
// depends on were deleted.
//
// One of them was a live bug. `commentNavigator` called `.on()` and `.get(0)` on
// a DOM element, jQuery methods on a library removed in v0.1.0, so the
// condition-builder threw the moment it was clicked and, being inside a `once()`
// handler, never recovered. eslint cannot see that; only a type checker can.
//
// So: keep Flow, freeze the backlog, same shape as `lint-baseline.mjs`. Per file
// rather than a total, because fixing one error while introducing another
// somewhere else nets out to "unchanged".
//
// NOT bumping flow-bin, deliberately. `.flowconfig` uses options Flow removed
// after 0.127 (`esproposal.*`, `suppress_comment`), and 242 minor versions of
// type-system tightening over 405 never-checked files would produce a far larger
// number without more signal. That is a separate decision; this one only requires
// that the count stop drifting.
//
// `node scripts/flow-baseline.mjs --update` after deliberately changing it.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'tests', 'fixtures', 'lint', 'flow-baseline.json');
const update = process.argv.includes('--update');

const flowBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'flow.cmd' : 'flow');
if (!fs.existsSync(flowBin)) {
	console.error(`flow not found at ${flowBin} — run \`yarn install\`.`);
	process.exit(1);
}

const run = spawnSync(flowBin, ['check', '--json', '--show-all-errors'], {
	cwd: repoRoot,
	encoding: 'utf8',
	maxBuffer: 256 * 1024 * 1024,
	shell: process.platform === 'win32',
});

if (run.error) {
	console.error('Could not run flow:', run.error.message);
	process.exit(1);
}

let report;
try {
	report = JSON.parse(run.stdout);
} catch (e) {
	console.error('flow did not emit parseable JSON. It probably failed to start:');
	console.error((run.stderr || run.stdout || '').slice(0, 2000));
	process.exit(1);
}

if (!Array.isArray(report.errors)) {
	console.error('flow reported no `errors` array. Treating that as a broken invocation, not a clean tree.');
	process.exit(1);
}

// A Flow error can span several files; attribute it to the file of its first
// message, which is where the error is reported.
const counts = {};
let parseErrors = 0;

for (const error of report.errors) {
	const first = (error.message || [])[0];
	const file = first && first.path ? path.relative(repoRoot, first.path).replace(/\\/g, '/') : '(unknown)';
	// Flow's `parse` kind covers two different things, and only one of them is
	// fatal. A file it cannot read contributes zero errors and looks clean, so that
	// must never be baselined. But 0.84 also files "Flow does not yet support method
	// or property calls in optional chains" under `parse` — a checker limitation on
	// syntax from 2020, affecting one expression, with the rest of the file still
	// analysed. That one is counted as an ordinary error so it stays visible.
	const text = (error.message || []).map(m => m.descr || '').join(' ');
	if (/Unexpected token|Unexpected identifier|Cannot parse|Unexpected end of input/i.test(text)) parseErrors += 1;
	counts[file] = (counts[file] || 0) + 1;
}

// A parse error means Flow could not read the file at all, so every type error it
// would have found is silently absent. That must never be baselined — it is the
// same failure as an eslint message with no rule id.
if (parseErrors) {
	console.error(`flow reported ${parseErrors} parse error(s). A file Flow cannot read contributes zero errors and looks clean.`);
	for (const error of report.errors) {
		if (/Unexpected token|Unexpected identifier|Cannot parse|Unexpected end of input/i.test((error.message || []).map(m => m.descr || '').join(' '))) {
			const first = (error.message || [])[0];
			console.error(`  ${first ? first.path : '?'}:${first ? first.line : '?'}`);
		}
	}
	process.exit(1);
}

const ordered = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(ordered).reduce((sum, n) => sum + n, 0);

if (update) {
	fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
	fs.writeFileSync(baselinePath, `${JSON.stringify({
		note: 'Per-file flow error counts. Regenerate with `node scripts/flow-baseline.mjs --update` and commit the change.',
		flowVersion: report.flowVersion || 'unknown',
		total,
		files: ordered,
	}, null, '\t')}\n`);
	console.log(`Flow baseline updated: ${total} errors across ${Object.keys(ordered).length} files (flow ${report.flowVersion || '?'}).`);
	process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
	console.error(`No baseline at ${baselinePath}. Create it with \`node scripts/flow-baseline.mjs --update\`.`);
	process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const expected = baseline.files || {};
const drift = [];

for (const file of new Set([...Object.keys(expected), ...Object.keys(ordered)])) {
	const was = expected[file] || 0;
	const now = ordered[file] || 0;
	if (was !== now) drift.push({ file, was, now });
}

if (!drift.length) {
	console.log(`flow matches the baseline: ${total} errors across ${Object.keys(ordered).length} files.`);
	process.exit(0);
}

console.error('flow errors no longer match the recorded baseline:\n');
for (const { file, was, now } of drift.sort((a, b) => a.file.localeCompare(b.file))) {
	console.error(`  ${(now > was ? 'NEW' : 'fixed').padEnd(6)} ${file}: ${was} -> ${now}`);
}
console.error(`\n  total: ${baseline.total} -> ${total}`);
console.error('\nIf you introduced these, fix them. If you fixed them, bank it:');
console.error('  yarn flow:baseline');
process.exit(1);
