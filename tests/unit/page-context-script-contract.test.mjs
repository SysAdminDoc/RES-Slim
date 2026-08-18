// `stopPageContextScript` neutralizes a page script before it can run.
//
// Thirteen `lib/utils` files had no test, and this one is the security-relevant
// member of that set: it is the mechanism that stops reddit's own scripts from
// executing, and "we stopped it" is a claim no source grep can check. A version
// that merely renamed the `type` attribute *after* the browser had already run
// the script would pass every structural assertion and block nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const PAGE = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body class="listing-page">
	<div id="header" role="banner"></div>
	<div class="content" role="main"><div id="siteTable"></div></div>
</body></html>`;

const Bundle = await loadModule('lib/modules/frictionRemovers.js', 'page-context-script', {
	dom: { url: 'https://old.reddit.com/r/all/', html: PAGE },
	alsoExport: { pageContextScript: 'lib/utils/pageContextScript.js' },
});
const { stopPageContextScript } = Bundle.pageContextScript;

// jsdom does not run scripts unless `runScripts` is enabled, so "did it
// execute?" cannot be measured here. What can be measured is every property the
// browser uses to decide: an executable type, a src it would fetch, and a body
// it would run. All three have to be gone.
function isNeutralized(script) {
	return script.type === 'javascript/blocked' && !script.src && script.innerHTML === '';
}

function appendScript(parent, attrs = {}, body = '') {
	const script = document.createElement('script');
	for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
	if (body) script.textContent = body;
	parent.append(script);
	return script;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

test('a matching inline script is stripped of everything that makes it run', async () => {
	const parent = document.querySelector('#siteTable');
	stopPageContextScript(script => /reddit-tracker/.test(script.innerHTML), parent, true);
	await flush();

	const blocked = appendScript(parent, { type: 'text/javascript' }, 'window.rsmPwned = true; // reddit-tracker');
	await flush();

	assert.equal(blocked.type, 'javascript/blocked', 'an unrecognised type is what stops the browser from executing it');
	assert.equal(blocked.innerHTML, '', 'and the body has to go, or a later type change re-arms it');
	assert.ok(isNeutralized(blocked));
});

test('a matching external script loses its src, so nothing is fetched', async () => {
	const parent = document.querySelector('#header');
	stopPageContextScript(script => script.src.includes('tracker.example.com'), parent, true);
	await flush();

	const blocked = appendScript(parent, { type: 'text/javascript', src: 'https://tracker.example.com/t.js' });
	await flush();

	assert.equal(blocked.getAttribute('src'), '', 'leaving the src would still cost the request, which is most of what the user objected to');
	assert.equal(blocked.type, 'javascript/blocked');
});

test('a script the test does not match is left exactly as it was', async () => {
	const parent = document.createElement('div');
	document.body.append(parent);
	stopPageContextScript(script => /never-matches-this/.test(script.innerHTML), parent, true);
	await flush();

	const kept = appendScript(parent, { type: 'text/javascript' }, 'window.legitimate = 1;');
	await flush();

	assert.equal(kept.type, 'text/javascript', 'a blocker that blocks everything is a broken page, not a safe one');
	assert.equal(kept.innerHTML, 'window.legitimate = 1;');
});

test('undo puts the script back, with what it originally was', async () => {
	const parent = document.createElement('div');
	document.body.append(parent);
	const handle = stopPageContextScript(script => /restore-me/.test(script.innerHTML), parent, true);
	await flush();

	const blocked = appendScript(parent, { type: 'text/javascript' }, 'window.restored = true; // restore-me');
	await flush();
	assert.ok(isNeutralized(blocked));

	handle.undo();
	await flush();

	const restored = parent.querySelectorAll('script');
	assert.equal(restored.length, 2, 'undo re-adds a script rather than un-blanking the corpse — the browser will not re-run an element it has already seen');
	const replacement = restored[1];
	assert.equal(replacement.type, 'text/javascript');
	assert.match(replacement.innerHTML, /restore-me/);
});

test('undo before anything matched stops later scripts being touched', async () => {
	const parent = document.createElement('div');
	document.body.append(parent);
	const handle = stopPageContextScript(() => true, parent, true);
	await flush();
	handle.undo();
	await flush();

	const late = appendScript(parent, { type: 'text/javascript' }, 'window.late = 1;');
	await flush();

	assert.equal(late.type, 'text/javascript', 'a blocker that has been called off must stay called off');
	assert.equal(late.innerHTML, 'window.late = 1;');
});

test('onlyChildrenOfParent decides how deep the blocker reaches', async () => {
	const shallowParent = document.createElement('div');
	const nested = document.createElement('div');
	shallowParent.append(nested);
	document.body.append(shallowParent);

	stopPageContextScript(script => /deep/.test(script.innerHTML), shallowParent, true);
	await flush();
	const deepUnderChildrenOnly = appendScript(nested, { type: 'text/javascript' }, '/* deep */');
	await flush();
	assert.equal(deepUnderChildrenOnly.type, 'text/javascript', 'children-only means children only');

	const deepParent = document.createElement('div');
	const deepNested = document.createElement('div');
	deepParent.append(deepNested);
	document.body.append(deepParent);

	stopPageContextScript(script => /deep/.test(script.innerHTML), deepParent, false);
	await flush();
	const deepUnderDescendants = appendScript(deepNested, { type: 'text/javascript' }, '/* deep */');
	await flush();
	assert.equal(deepUnderDescendants.type, 'javascript/blocked', 'and descendants means any depth');
});

test('a selector parent is resolved, not required up front', async () => {
	// The caller may hand this a selector for an element reddit has not rendered
	// yet — that is the normal case at document_start, and the whole reason the
	// parent may be a string or a promise.
	const late = document.createElement('div');
	late.id = 'rsm-late-parent';

	stopPageContextScript(script => /late-parent/.test(script.innerHTML), '#rsm-late-parent', true);
	document.body.append(late);
	await flush();

	const blocked = appendScript(late, { type: 'text/javascript' }, '/* late-parent */');
	await flush();
	assert.ok(isNeutralized(blocked), 'waiting for the parent is the point; missing it means the scripts run');
});
