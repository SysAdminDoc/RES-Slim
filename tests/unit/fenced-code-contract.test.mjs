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
const { escapeHtml, parseSingleFence, hasFencePair, tokenizeToHtml, buildCodeBlockHtml } =
	await import(pathToFileURL(modulePath).href);

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
