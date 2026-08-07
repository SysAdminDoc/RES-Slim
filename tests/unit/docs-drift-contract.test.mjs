// Counts that documentation states must match what the tree actually contains.
//
// README, CLAUDE.md and ROADMAP.md have drifted from reality repeatedly — 87 host
// handlers against an actual 73, "99 modules" against 98 and then 113 — and each
// time the fix was a human noticing. A stale count is worse than no count: it is
// the number the next research pass trusts instead of counting for itself.
//
// Only README.md is tracked by git (every other .md here is gitignored), so it is
// the one this contract can enforce for a fresh clone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const readme = read('README.md');

function countHostHandlers() {
	return fs.readdirSync(path.join(repoRoot, 'lib', 'modules', 'hosts'))
		.filter(name => name.endsWith('.js') && name !== 'index.js')
		.length;
}

function countRegisteredModules() {
	return (read('lib/modules/index.js').match(/^import \{ module as /gm) || []).length;
}

test('the host-handler count in README matches the files on disk', () => {
	const actual = countHostHandlers();
	const claimed = readme.match(/all (\d+) host handlers/);

	assert.ok(claimed, 'README should state the host-handler count');
	assert.equal(Number(claimed[1]), actual, `README claims ${claimed[1]} host handlers; there are ${actual}`);
});

test('every module count stated in README matches the registry', () => {
	const actual = countRegisteredModules();
	// Any "<n> modules" claim in prose, whatever the surrounding sentence.
	const claims = [...readme.matchAll(/(\d+)\s+modules\b/g)].map(m => Number(m[1]));

	for (const claimed of claims) {
		// Version-scoped claims ("fifteen modules in v0.20.0") are written as words,
		// so a bare digit here is a claim about the current total.
		assert.equal(claimed, actual, `README claims ${claimed} modules; the index registers ${actual}`);
	}
});

test('README does not describe a public repository as private', () => {
	// The repo is public on GitHub. Calling it private in the README is the kind of
	// drift that makes a reader distrust everything else in the file.
	assert.ok(
		!/\bprivate fork\b/i.test(readme),
		'README calls this a "private fork", but it is published publicly',
	);
});

test('the version badge matches package.json', () => {
	const pkg = JSON.parse(read('package.json'));
	const badge = readme.match(/version-(\d+\.\d+\.\d+)-blue/);

	assert.ok(badge, 'README should carry a version badge');
	assert.equal(badge[1], pkg.version, 'README badge and package.json disagree about the current version');
});
