#!/usr/bin/env node
// `yarn release <version>` — the one place a version number is written.
//
// Why this exists: the version lives in four files (package.json, the README
// badge, the CHANGELOG heading, the CLAUDE.md history) and tagging is a fifth
// step a person has to remember. `docs-drift-contract` catches a mismatch, but
// only after the fact, and the six untagged releases v0.31.0-v0.35.1 are what
// "remember to tag" actually produces. Two consecutive releases were cut by hand
// before this was written, which is two more than the evidence needed.
//
// It does not push. Pushing runs the pre-push hook, which runs every gate, and
// that is the right order — but it should be the operator's deliberate act.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const write = (file, contents) => fs.writeFileSync(path.join(repoRoot, file), contents);

function fail(message) {
	console.error(`release: ${message}`);
	process.exit(1);
}

function git(...args) {
	const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
	if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
	return (result.stdout || '').trim();
}

const version = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	fail('usage: yarn release <major.minor.patch> [--dry-run]');
}

// Refuse a re-run rather than producing a second commit for the same version,
// an empty CHANGELOG section, or a tag that already points somewhere else.
const pkg = JSON.parse(read('package.json'));
if (pkg.version === version) fail(`package.json is already ${version} — a release is not idempotent, so this is refused rather than repeated`);
if (git('tag', '--list', `v${version}`)) fail(`tag v${version} already exists`);

// A release records what is in the tree, so the tree has to be the tree.
const dirty = git('status', '--porcelain').split('\n').filter(Boolean)
	// .md files other than README are gitignored here, so an edited CHANGELOG or
	// ROADMAP is not "uncommitted work" in the sense that matters.
	.filter(line => !/\.md$/.test(line) && !line.startsWith('??'));
if (dirty.length) fail(`working tree has uncommitted changes:\n  ${dirty.join('\n  ')}`);

const today = new Date().toISOString().slice(0, 10);

// --- package.json ------------------------------------------------------------
const pkgSource = read('package.json');
const pkgUpdated = pkgSource.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);
if (pkgUpdated === pkgSource) fail('could not find the version field in package.json');

// --- README badge ------------------------------------------------------------
const readme = read('README.md');
const readmeUpdated = readme.replace(/version-\d+\.\d+\.\d+-blue/g, `version-${version}-blue`);
if (readmeUpdated === readme) fail('could not find the version badge in README.md');

// --- CHANGELOG ---------------------------------------------------------------
// The heading moves rather than being inserted: work lands under `## Unreleased`
// as it is written, and a release is the act of naming that section.
const changelog = read('CHANGELOG.md');
if (!/^## Unreleased$/m.test(changelog)) {
	fail('CHANGELOG.md has no "## Unreleased" section — write the entries first, then release them');
}
const changelogUpdated = changelog.replace(/^## Unreleased$/m, `## v${version} - ${today}`);

const files = [
	['package.json', pkgUpdated],
	['README.md', readmeUpdated],
	['CHANGELOG.md', changelogUpdated],
];

if (dryRun) {
	console.log(`release: would set version ${pkg.version} -> ${version} in:`);
	for (const [file] of files) console.log(`  ${file}`);
	console.log(`release: would commit "chore: release ${version}" and tag v${version}`);
	process.exit(0);
}

for (const [file, contents] of files) write(file, contents);

// The version string is compiled into every bundle, so the size ratchet has to
// be re-recorded in the same change or the next build fails on the release
// commit itself.
const baseline = spawnSync('yarn bundle:baseline', { cwd: repoRoot, stdio: 'inherit', shell: true });
if (baseline.status !== 0) fail('bundle:baseline failed');

// Only README.md and package.json are tracked; the rest of the .md files are
// gitignored, which is why the CHANGELOG edit above does not appear here.
git('add', 'package.json', 'README.md', 'tests/fixtures/lint/bundle-baseline.json');
git('commit', '-m', `chore: release ${version}`);
git('tag', '-a', `v${version}`, '-m', `v${version}`);

console.log(`release: ${pkg.version} -> ${version}, committed and tagged v${version}.`);
console.log('release: run `git push && git push --tags` — the pre-push hook runs every gate.');
