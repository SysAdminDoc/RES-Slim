import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-text-diff');
fs.mkdirSync(tmpDir, { recursive: true });
// `escapeHtmlText` lives in lib/utils/html.js now, so it has to be emitted
// beside the module under test.
fs.writeFileSync(path.join(tmpDir, 'html.mjs'), flowRemoveTypes(read('lib/utils/html.js'), { all: true }).toString());
const stripped = flowRemoveTypes(read('lib/utils/textDiff.js'), { all: true }).toString().replace('from \'./html\'', 'from \'./html.mjs\'');
const modulePath = path.join(tmpDir, 'textDiff.mjs');
fs.writeFileSync(modulePath, stripped);
const { tokenize, diffTokens, hasChanges, renderDiffHtml } = await import(pathToFileURL(modulePath).href);

test('tokenize keeps words and whitespace so text can be rebuilt', () => {
	assert.deepEqual(tokenize('a b'), ['a', ' ', 'b']);
	assert.equal(tokenize('one two three').join(''), 'one two three');
	assert.deepEqual(tokenize(''), []);
});

test('diffTokens marks inserted and deleted words', () => {
	const segs = diffTokens('the quick brown fox', 'the slow brown fox');
	const dels = segs.filter(s => s.type === 'del').map(s => s.value.trim());
	const inss = segs.filter(s => s.type === 'ins').map(s => s.value.trim());
	assert.ok(dels.includes('quick'));
	assert.ok(inss.includes('slow'));
	assert.equal(segs.filter(s => s.type === 'equal').map(s => s.value).join('').includes('brown fox'), true);
});

test('hasChanges is false for identical text', () => {
	assert.equal(hasChanges(diffTokens('same text', 'same text')), false);
	assert.equal(hasChanges(diffTokens('a', 'b')), true);
});

test('renderDiffHtml escapes content and wraps ins/del', () => {
	const html = renderDiffHtml(diffTokens('<b>old</b>', '<b>new</b>'));
	assert.doesNotMatch(html, /<b>/);
	assert.match(html, /&lt;b&gt;/);
	assert.match(html, /<del class="rsm-diff-del">/);
	assert.match(html, /<ins class="rsm-diff-ins">/);
});

test('editedCommentDiff module is registered, disabled by default, styled', () => {
	const mod = read('lib/modules/editedCommentDiff.js');
	assert.match(mod, /module\.disabledByDefault = true;/);
	assert.match(mod, /time\.edited-timestamp/);
	assert.match(mod, /fetchFromArcticShift/);
	assert.match(mod, /fetchFromPullPush/);
	assert.match(mod, /setTrustedHTML\(panel, renderDiffHtml\(segments\)\)/);

	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as editedCommentDiff \} from '\.\/editedCommentDiff';/);
	assert.match(index, /^\s*editedCommentDiff,/m);
	assert.match(read('lib/css/res.scss'), /@import 'modules\/editedCommentDiff';/);
});
