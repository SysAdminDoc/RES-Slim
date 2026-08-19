import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-fenced-code');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(read('lib/utils/fencedCode.js'), { all: true }).toString();
const modulePath = path.join(tmpDir, 'fencedCode.mjs');
fs.writeFileSync(modulePath, stripped);
const Fenced = await import(pathToFileURL(modulePath).href);
const { escapeHtml, parseSingleFence, hasFencePair, tokenizeToHtml, buildCodeBlockHtml } = Fenced;

test('parseSingleFence extracts language and code for a whole-block fence', () => {
	assert.deepEqual(parseSingleFence('```js\nconst x = 1;\n```'), { lang: 'js', code: 'const x = 1;' });
	assert.deepEqual(parseSingleFence('  ```\nplain\n```  '), { lang: '', code: 'plain' });
	assert.equal(parseSingleFence('no fence here'), null);
	assert.equal(parseSingleFence('text ```inline``` text'), null);
});

test('hasFencePair detects a multi-line fenced block', () => {
	assert.equal(hasFencePair('```\ncode\n```'), true);
	assert.equal(hasFencePair('```js\na\nb\n```'), true);
	assert.equal(hasFencePair('just text'), false);
});

test('tokenizeToHtml escapes all content, including inside tokens', () => {
	const html = tokenizeToHtml('const s = "<script>";');
	assert.doesNotMatch(html, /<script>/);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /rsm-tok-keyword">const/);
	assert.match(html, /rsm-tok-string/);
});

test('tokenizeToHtml wraps comments and numbers', () => {
	const html = tokenizeToHtml('x = 42 # note');
	assert.match(html, /rsm-tok-number">42/);
	assert.match(html, /rsm-tok-comment"># note/);
});

test('buildCodeBlockHtml emits a pre>code with an escaped language label', () => {
	const html = buildCodeBlockHtml('py', 'print(1)', false);
	assert.match(html, /^<pre class="rsm-fenced" data-lang="py">/);
	assert.match(html, /<span class="rsm-fenced-lang">py<\/span>/);
	assert.match(html, /<code class="language-py">print\(1\)<\/code>/);
});

test('fencedCodeBlocks is registered and styled', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as fencedCodeBlocks \} from '\.\/fencedCodeBlocks';/);
	assert.match(index, /^\s*fencedCodeBlocks,/m);
	assert.match(read('lib/css/res.scss'), /@import 'modules\/fencedCodeBlocks';/);
});

test('escapeHtml neutralizes markup', () => {
	assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});

test('fencedCodeBlocks is on by default, with highlighting opt-in', () => {
	const mod = read('lib/modules/fencedCodeBlocks.js');
	// old.reddit renders a fenced block as literal text with the backticks
	// showing, so this is a fix rather than a preference. Colouring the block is
	// a preference, and stays off.
	assert.doesNotMatch(mod, /module\.disabledByDefault/);
	assert.match(mod, /highlight: \{[\s\S]{0,200}value: false,/);
	assert.match(mod, /buildCodeBlockHtml\(parsed\.lang, parsed\.code, highlight\)/);
	assert.match(mod, /setTrustedHTML\(md,/);

	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as fencedCodeBlocks \} from '\.\/fencedCodeBlocks';/);
	assert.match(index, /^\s*fencedCodeBlocks,/m);

	assert.match(read('lib/css/res.scss'), /@import 'modules\/fencedCodeBlocks';/);
});

test('the preview and the page agree about a fenced block', async () => {
	// snudown-js is built without MKDEXT_FENCED_CODE, so a triple-backtick block
	// came out of the preview as `<p><code>` while `fencedCodeBlocks` rendered the
	// same text on the page as `<pre><code>`. The preview and the page disagreed
	// about the one construct that module exists for.
	const { markdown } = await import('snudown-js');
	const raw = markdown('```\njs code here\n```');
	assert.doesNotMatch(raw, /<pre/, 'snudown grew fenced-code support; this workaround can go');
	assert.match(raw, /<p><code>/);

	const segments = Fenced.splitFences('```js\nconst a = 1;\n```');
	assert.equal(segments.length, 1);
	assert.equal(segments[0].type, 'fence');
	assert.equal(segments[0].lang, 'js');
	assert.equal(segments[0].content, 'const a = 1;');

	// Same builder, so the two cannot drift apart.
	const preview = Fenced.buildCodeBlockHtml(segments[0].lang, segments[0].content, false);
	const onPage = Fenced.buildCodeBlockHtml('js', 'const a = 1;', false);
	assert.equal(preview, onPage);
	assert.match(preview, /^<pre class="rsm-fenced"/);
});

test('prose around a fence is still snudown\'s job', () => {
	const segments = Fenced.splitFences('before\n\n```py\nx = 1\n```\n\nafter');
	assert.deepEqual(segments.map(s => s.type), ['text', 'fence', 'text']);
	assert.match(segments[0].content, /before/);
	assert.equal(segments[1].content, 'x = 1');
	assert.match(segments[2].content, /after/);
});

test('an unterminated fence is left as prose', () => {
	// A live preview sees every intermediate state of what is being typed. Treating
	// a half-typed fence as a block would swallow the rest of the comment while the
	// user is still writing it.
	const segments = Fenced.splitFences('text\n```js\nstill typing');
	assert.deepEqual(segments.map(s => s.type), ['text']);
});

test('the preview routes fences through the page builder, not through snudown', () => {
	const source = read('lib/modules/commentPreview.js');
	assert.match(source, /renderMarkdownWithFences\(md, markdown\)/);
	assert.match(source, /buildCodeBlockHtml\(segment\.lang, segment\.content, highlight\)/);
	// Colouring is the fencedCodeBlocks option; the preview must not invent its own.
	assert.match(source, /fencedCodeBlocks\.options\.highlight\.value/);
});
