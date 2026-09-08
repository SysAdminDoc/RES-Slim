// Three things that go wrong for one reader and then stay wrong.
//
// The settings console renders an option's `values` array straight out of the
// module. When a stored value is one an upgrade dropped, it pushed a
// "(not available)" entry onto that array so the reader can see what they had --
// but the array is the module's own, because `getOptions()` shallow-spreads. So
// one table row holding a stale value added a phantom choice to every row drawn
// after it, kept the dropped value re-selectable, and the mutation lived for the
// session: search and the changed-settings view read the same array.
//
// A hand-written settings link with a malformed percent-escape threw a URIError
// out of the hash parser, which runs in a capture-phase click handler before
// `preventDefault` -- so the console never opened and the click fell through.
//
// And the hover card's `populate` had a branch that assigned a string to
// `innerHTML` raw. Nothing outside the module used it; the load indicator inside
// it did.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/', html: '<!doctype html><html><body></body></html>' });

const nav = await loadFlowModule('lib/modules/settingsNavigation.js', 'settings-console-render-nav', {
	stubs: {
		'../constants/urlHashes': 'export const RES_SETTINGS_HASH = "#res:settings";\n',
		'../environment': 'export const context = { origin: "https://old.reddit.com" };\nexport const isOptionsPage = () => false;\nexport const getOptionsURL = () => new URL("chrome-extension://res/options.html");\nexport const i18n = key => key;\nexport const openNewTab = () => {};\n',
		'../utils': 'export const escapeHTML = value => String(value);\nexport const string = () => "";\n',
		'../utils/currentLocation': 'export const appType = () => "r2";\nexport const pageType = () => "linklist";\n',
		'../utils/profiling': 'export const getModuleSummary = () => [];\n',
		'../utils/selectorDrift': 'export const describeRenderer = () => "";\n',
		'../core/module': 'export class Module { constructor(id) { this.moduleID = id; this.options = {}; } }\n',
		'../core/modules': 'export const getUnchecked = () => null;\n',
		'../modules/menu': 'export const addMenuItem = () => {};\n',
		'../utils/actionLog': 'export const actionLogSize = () => 0;\nexport const clearActionLog = () => {};\nexport const readActionLog = () => [];\n',
	},
});

test('a settings link that will not decode still names its module', () => {
	// The whole point of the guard: a segment that cannot be decoded is kept as it
	// was written, so it matches no module -- which is the ordinary "unknown
	// module" path -- rather than throwing out of a click handler.
	for (const [hash, moduleID, optionKey] of [
		['#res:settings/%E0%A4%A', '%E0%A4%A', undefined],
		['#res:settings/showImages/%', 'showImages', '%'],
		['#res:settings/%ZZ/%GG', '%ZZ', '%GG'],
		['#res:settings/show%20Images', 'show Images', undefined],
		['#res:settings/showImages/displayImageCaptions', 'showImages', 'displayImageCaptions'],
		['#res:settings', undefined, undefined],
	]) {
		let parsed;
		assert.doesNotThrow(() => { parsed = nav.parseHash(hash); }, `${hash} threw`);
		assert.equal(parsed.moduleID, moduleID, hash);
		assert.equal(parsed.optionKey, optionKey, hash);
	}
});

test('both renderers draw from the copy and nothing writes to the module array', () => {
	// The two renderers are the two call sites, and the assertion that matters is
	// that neither of them still builds the list itself.
	const source = codeOnly(readRepoFile('lib/options/settingsConsole.js'));

	for (const [kind, local] of [['enum', 'enumValues'], ['select', 'selectValues']]) {
		assert.ok(
			source.includes(`const ${local} = renderableValues(optionObject);`),
			`the ${kind} renderer does not use the shared copy`,
		);
		const block = source.slice(source.indexOf(`const ${local} = renderableValues`));
		assert.ok(block.slice(0, 200).includes(`${local}.forEach`), `the ${kind} renderer iterates the wrong list`);
	}

	assert.ok(
		!/optionObject\.values\.push\(/.test(source),
		'the placeholder is still pushed into the array the module owns',
	);
});

test('rendering one stale row does not add a choice to the next', async () => {
	// The real function, not a copy of it written into the test. The previous
	// version of this test defined its own `render` closure and passed against a
	// reverted `settingsConsole.js`, which is the failure mode it existed to stop.
	const { renderableValues } = await loadFlowModule('lib/options/optionValues.js', 'settings-console-render-values');

	const moduleValues = [{ name: 'One', value: 'one' }, { name: 'Two', value: 'two' }];
	const stale = { value: 'gone', values: moduleValues };

	const first = renderableValues(stale);
	assert.equal(first.length, 3, 'the reader cannot see what they had');
	assert.deepEqual(first[2], { name: 'gone (not available)', value: 'gone' });
	assert.equal(moduleValues.length, 2, 'the module array grew');

	const second = renderableValues(stale);
	assert.equal(second.filter(entry => entry.value === 'gone').length, 1, 'the placeholder was added twice');
	assert.equal(moduleValues.length, 2, 'the module array grew on the second render');
	assert.notEqual(first, second, 'both renders share one array');

	// A value that is still on offer adds nothing, and neither does no value at
	// all: without this the function could return a placeholder unconditionally.
	assert.deepEqual(renderableValues({ value: 'two', values: moduleValues }), moduleValues);
	assert.deepEqual(renderableValues({ value: '', values: moduleValues }), moduleValues);
	assert.deepEqual(renderableValues({ value: null, values: moduleValues }), moduleValues);
});

test('the hover card builds its contents rather than parsing them', () => {
	const source = codeOnly(readRepoFile('lib/modules/hover.js'));

	// The one `innerHTML` left is the card's own template, which is a constant in
	// this file and never anything a caller passed. That is a different thing from
	// the branch that took a caller's string, and it is checked rather than
	// asserted away: every assignment to it comes from `this.template`.
	const assignments = [...source.matchAll(/(\w+)\.innerHTML = ([^;]+);/g)].map(match => match[2].trim());
	assert.deepEqual(assignments, ['this.template.trim()'], `hover.js assigns innerHTML from ${assignments.join(', ')}`);
	// And `this.template` is a literal in this file rather than anything assigned
	// from outside it. A `matchAll` loop stood here and asserted nothing: a match
	// object is always truthy, and with no matches the body never ran.
	const assigned = [...source.matchAll(/\btemplate(?::\s*string)?\s*=\s*/g)];
	const literals = [...source.matchAll(/\btemplate(?::\s*string)?\s*=\s*`/g)];
	assert.ok(literals.length > 0, 'hover.js declares no template at all');
	assert.equal(literals.length, assigned.length, `${assigned.length - literals.length} hover template(s) come from somewhere else`);

	assert.match(source, /type HoverContents = HTMLElement \| DocumentFragment \| null;/);
	// The load indicator was the only thing using the branch, so it has to be the
	// thing that proves the branch is gone.
	assert.match(source, /_loadIndicator\(\): HTMLElement \{/);
	assert.match(source, /this\.populate\(\[ellipsis, this\._loadIndicator\(\)\]\);/);
});
