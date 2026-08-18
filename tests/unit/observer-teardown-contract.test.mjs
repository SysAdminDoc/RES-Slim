// MutationObservers must have a way to be turned off.
//
// Two distinct failures were found on 2026-08-18. Four modules declared
// `let observer: MutationObserver | null = null` — a slot whose whole point is
// teardown — and never disconnected, so a second setup call would orphan the
// first observer while leaving it running: two observers doing identical work,
// one of them unreachable. And `Expando` created an anonymous observer per
// expando button with no reference held at all, on pages that append 25 more
// buttons per infinite-scroll page, each one pinning its own detached button.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const libDir = path.join(repoRoot, 'lib');

function* jsFiles(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* jsFiles(full);
		else if (entry.name.endsWith('.js')) yield full;
	}
}

const sources = [...jsFiles(libDir)].map(file => ({
	file: path.relative(repoRoot, file).split(path.sep).join('/'),
	source: fs.readFileSync(file, 'utf8'),
}));

test('the scan sees the files it is meant to police', () => {
	// A scan that matches nothing passes every assertion below for free.
	const declaring = sources.filter(s => /let observer\s*:\s*MutationObserver/.test(s.source));
	assert.ok(declaring.length >= 4, `expected the modules declaring an observer slot, found ${declaring.length}`);
});

const declaresSlot = s => /let observer\s*:\s*MutationObserver/.test(s.source);

test('a declared observer slot is actually used for teardown', () => {
	// Match any identifier ending in `bserver` so the `currentObserver` alias
	// `classicFavicon` uses to disconnect from inside its own callback counts.
	const offenders = sources
		.filter(declaresSlot)
		.filter(s => !/\w*[Oo]bserver\.disconnect\(\)/.test(s.source))
		.map(s => s.file);

	assert.deepEqual(
		offenders,
		[],
		`these declare a nullable observer slot but never disconnect it:\n  ${offenders.join('\n  ')}`,
	);
});

test('setup cannot leave a second observer running', () => {
	// Two shapes are correct and both are in use, so accept either rather than
	// forcing one spelling:
	//   - disconnect the previous observer before reassigning the slot, or
	//   - bail out when the slot is already filled (`classicFavicon`).
	// What is not acceptable is reassigning over a live observer, which leaves it
	// running and unreachable.
	for (const { file, source } of sources.filter(declaresSlot)) {
		const assignment = source.indexOf('observer = new MutationObserver');
		assert.ok(assignment > 0, `${file} should assign into the declared slot`);
		const before = source.slice(Math.max(0, assignment - 400), assignment);
		assert.ok(
			/if \(observer\) observer\.disconnect\(\);/.test(before) || /if \(observer\) return;/.test(before),
			`${file} reassigns its observer slot without either disconnecting the previous one or bailing out first`,
		);
	}
});

test('the per-button expando observer is held and disconnected', () => {
	const expando = sources.find(s => s.file === 'lib/modules/showImages/expando.js');
	assert.ok(expando, 'expando.js should exist');

	// An observer nobody holds a reference to can never be disconnected.
	assert.doesNotMatch(
		expando.source,
		/new MutationObserver\([^)]*\)\.observe\(/,
		'an inline `new MutationObserver(...).observe(...)` keeps no reference and can never be torn down',
	);
	assert.match(expando.source, /this\.buttonObserver = new MutationObserver/);

	const destroy = expando.source.slice(expando.source.indexOf('destroy()'));
	assert.match(destroy, /this\.buttonObserver\.disconnect\(\)/, 'destroy() must disconnect the button observer');
});
