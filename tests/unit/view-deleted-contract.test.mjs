// `viewDeleted` used to collapse every failure to `null`, so "this comment was
// never archived" and "you are rate-limited, try again shortly" both rendered as
// "not in archive". pullpush rate-limits readily — it answered 429 to a single
// probe on 2026-08-18 — so the misleading branch was the common one.
//
// This is a source contract rather than a behavioural one because the module
// reaches the network through `ajax` and the DOM through `Thing`; the useful
// invariant is that the reasons stay distinct and that only the terminal one is
// terminal.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'lib/modules/viewDeleted.js'), 'utf8');

test('the archive fetch distinguishes its failure reasons', () => {
	// A bare `catch { return null; }` is what conflated them.
	assert.doesNotMatch(source, /catch\s*\{\s*return null;\s*\}/);
	for (const reason of ['not-found', 'rate-limited', 'server-error', 'network']) {
		assert.ok(source.includes(`'${reason}'`), `failure reason "${reason}" must be distinguishable`);
	}
});

test('a rate limit is read from the response status, not guessed', () => {
	assert.match(source, /getStatusFromError/);
	assert.match(source, /status === 429/);
	assert.match(source, /reason: 'rate-limited'/);
});

test('each reason gets its own user-facing label', () => {
	const labels = source.slice(source.indexOf('function failureLabel'));
	assert.match(labels, /rate-limited[\s\S]*?try later/);
	assert.match(labels, /network error/);
	assert.match(labels, /archive server error/);
	assert.match(labels, /not in archive/);
});

test('only "not in archive" is terminal', () => {
	// The link stays clickable regardless, so leaving a dead-end message on a
	// transient failure tells the user to give up on a comment the archive may
	// well have. Everything except not-found restores the actionable label.
	assert.match(source, /archived\.reason !== 'not-found'/);
	assert.match(source, /RESTORE_LABEL/);
});

test('the restore link and its reset use one label constant', () => {
	// Two copies of the string would drift, and the reset would silently stop
	// matching the label it is meant to restore.
	const literals = source.match(/\[restore from archive\]/g) || [];
	assert.equal(literals.length, 1, 'the label text must be defined once');
	assert.match(source, /const RESTORE_LABEL = '\[restore from archive\]'/);
});
