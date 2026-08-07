import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const at = await loadFlowModule('lib/utils/autoTranslate.js', 'auto-translate');
const mod = readRepoFile('lib/modules/preventAutoTranslate.js');

test('the tl parameter is removed and everything else survives', () => {
	assert.equal(
		at.stripTranslationParams('/r/aww/comments/abc/title/?tl=es&sort=top'),
		'/r/aww/comments/abc/title/?sort=top');
	assert.equal(
		at.stripTranslationParams('https://old.reddit.com/r/aww/?tl=de'),
		'https://old.reddit.com/r/aww/');
});

test('a URL without the parameter returns null so no DOM write happens', () => {
	assert.equal(at.stripTranslationParams('/r/aww/'), null);
	assert.equal(at.stripTranslationParams('https://old.reddit.com/r/aww/?sort=new'), null);
	assert.equal(at.stripTranslationParams(''), null);
	assert.equal(at.stripTranslationParams(null), null);
});

test('a fragment survives the rewrite', () => {
	assert.equal(at.stripTranslationParams('/r/aww/?tl=fr#comments'), '/r/aww/#comments');
});

test('a relative URL stays relative', () => {
	const out = at.stripTranslationParams('/r/aww/?tl=fr');
	assert.equal(out, '/r/aww/');
	assert.ok(!out.startsWith('http'));
});

test('hasTranslationParam matches the parameter, not the substring', () => {
	assert.equal(at.hasTranslationParam('/r/aww/?tl=es'), true);
	assert.equal(at.hasTranslationParam('/r/aww/?sort=top&tl=es'), true);
	// `title`, `html` and `controls` all contain "tl".
	assert.equal(at.hasTranslationParam('/r/aww/?title=x'), false);
	assert.equal(at.hasTranslationParam('/r/tldr/'), false);
	assert.equal(at.hasTranslationParam('/r/aww/?controls=1'), false);
});

test('the current URL is replaced rather than pushed', () => {
	// A translated URL is not somewhere the user chose to be, so it must not take
	// a back-button entry.
	assert.match(mod, /history\.replaceState\(/);
	assert.doesNotMatch(mod, /history\.pushState\(/);
	// And reloading has to stay opt-in, since it costs a round trip.
	assert.match(mod, /reloadIfTranslated: \{[\s\S]{0,120}value: false/);
});

test('links are cleaned too, not only the address bar', () => {
	// Every link on a translated page is rendered carrying the parameter, so
	// cleaning the address bar alone lasts exactly one navigation.
	assert.match(mod, /watchForElements\(\['page'\], 'a\[href\]'/);
});
