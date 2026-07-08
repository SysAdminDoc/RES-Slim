import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-comment-highlights');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(read('lib/utils/commentHighlights.js'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'commentHighlights.mjs');
fs.writeFileSync(modulePath, stripped);
const { isRevisit, isNewComment } = await import(pathToFileURL(modulePath).href);

test('isRevisit is false on a first visit (no stored timestamp)', () => {
	assert.equal(isRevisit(null), false);
	assert.equal(isRevisit(undefined), false);
	assert.equal(isRevisit(0), false);
	assert.equal(isRevisit(NaN), false);
});

test('isRevisit is true only for a stored positive timestamp', () => {
	assert.equal(isRevisit(1), true);
	assert.equal(isRevisit(1_700_000_000_000), true);
});

test('isNewComment never highlights on a first visit', () => {
	// A brand-new thread: no last-visit timestamp -> nothing is "new".
	assert.equal(isNewComment(1_700_000_000_000, null), false);
	assert.equal(isNewComment(1_700_000_000_000, 0), false);
	assert.equal(isNewComment(1_700_000_000_000, undefined), false);
});

test('isNewComment highlights only comments posted after the last visit', () => {
	const lastVisit = 1_700_000_000_000;
	assert.equal(isNewComment(lastVisit + 1000, lastVisit), true); // posted after
	assert.equal(isNewComment(lastVisit - 1000, lastVisit), false); // posted before
	assert.equal(isNewComment(lastVisit, lastVisit), false); // exactly at visit
});

test('commentHighlights module gates highlighting on a genuine revisit', () => {
	const src = read('lib/modules/commentHighlights.js');
	assert.match(src, /if \(isRevisit\(last\)\) highlightFrom\(Number\(last\)\)/);
	assert.match(src, /isNewComment\(ts\.getTime\(\), lastVisit\)/);
	// The old bug: an unconditional highlightFrom with a `|| 0` fallback.
	assert.doesNotMatch(src, /\(await store\.getNullable\(key\)\) \|\| 0/);
	// The visit is still recorded (so the next visit works).
	assert.match(src, /store\.set\(key, Date\.now\(\)\)/);
});
