// Turns eslint from noise into a gate.
//
// `yarn eslint` has exited non-zero for as long as anyone has run it, so it could
// never gate anything and a genuinely new violation was invisible against the
// backlog. Recent passes counted the total by hand to prove they had not
// regressed it, which is not a check — it is a habit.
//
// This compares the per-rule violation counts against `tests/fixtures/lint/
// eslint-baseline.json` and fails when they differ **in either direction**:
//
//   - a count that rose is a new violation, which is the point;
//   - a count that fell is good work that must be banked by updating the
//     baseline, or the headroom silently absorbs the next regression;
//   - per-rule rather than a single total, so fixing one violation while
//     introducing another somewhere else does not net out to "unchanged".
//
// Run `node scripts/lint-baseline.mjs --update` after deliberately changing the
// count. The baseline is committed, so the change shows up in review.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'tests', 'fixtures', 'lint', 'eslint-baseline.json');
const update = process.argv.includes('--update');

const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!fs.existsSync(eslintBin)) {
	console.error(`eslint not found at ${eslintBin} — run \`yarn install\`.`);
	process.exit(1);
}

const run = spawnSync(process.execPath, [eslintBin, '.', '--format', 'json'], {
	cwd: repoRoot,
	encoding: 'utf8',
	maxBuffer: 64 * 1024 * 1024,
});

// eslint exits 1 when it finds problems and 2 when it fails to run. Only the
// latter is fatal here — but an unparseable stdout is fatal either way, because
// an empty result would otherwise read as a perfectly clean tree.
if (run.error) {
	console.error('Could not run eslint:', run.error.message);
	process.exit(1);
}

let results;
try {
	results = JSON.parse(run.stdout);
} catch (e) {
	console.error('eslint did not emit parseable JSON. It probably failed to start:');
	console.error(run.stderr || run.stdout);
	process.exit(1);
}

if (!Array.isArray(results) || results.length === 0) {
	console.error('eslint reported on zero files. That is a broken invocation, not a clean tree.');
	process.exit(1);
}

const counts = {};
let files = 0;
for (const file of results) {
	files += 1;
	for (const message of file.messages) {
		// Parse errors have no ruleId and must never be absorbed into a baseline.
		if (!message.ruleId) {
			console.error(`${file.filePath}:${message.line} ${message.message}`);
			console.error('A message with no rule is a parse failure. Fix it; it cannot be baselined.');
			process.exit(1);
		}
		if (message.severity !== 2) continue;
		counts[message.ruleId] = (counts[message.ruleId] || 0) + 1;
	}
}

const ordered = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(ordered).reduce((sum, n) => sum + n, 0);

if (update) {
	fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
	fs.writeFileSync(baselinePath, `${JSON.stringify({
		note: 'Per-rule eslint error counts. Regenerate with `node scripts/lint-baseline.mjs --update` and commit the change.',
		total,
		rules: ordered,
	}, null, '\t')}\n`);
	console.log(`Baseline updated: ${total} errors across ${Object.keys(ordered).length} rules, ${files} files linted.`);
	process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
	console.error(`No baseline at ${baselinePath}. Create it with \`node scripts/lint-baseline.mjs --update\`.`);
	process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const expected = baseline.rules || {};
const drift = [];

for (const rule of new Set([...Object.keys(expected), ...Object.keys(ordered)])) {
	const was = expected[rule] || 0;
	const now = ordered[rule] || 0;
	if (was !== now) drift.push({ rule, was, now });
}

if (!drift.length) {
	console.log(`eslint matches the baseline: ${total} errors across ${Object.keys(ordered).length} rules, ${files} files linted.`);
	process.exit(0);
}

console.error('eslint violations no longer match the recorded baseline:\n');
for (const { rule, was, now } of drift.sort((a, b) => a.rule.localeCompare(b.rule))) {
	const direction = now > was ? 'NEW' : 'fixed';
	console.error(`  ${direction.padEnd(6)} ${rule}: ${was} -> ${now}`);
}
console.error(`\n  total: ${baseline.total} -> ${total}`);
console.error('\nIf you introduced these, fix them. If you fixed them, bank it:');
console.error('  node scripts/lint-baseline.mjs --update');
process.exit(1);
