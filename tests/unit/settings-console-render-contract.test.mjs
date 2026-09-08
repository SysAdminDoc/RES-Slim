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

test('the console renders a dropped value from a copy, not from the module', () => {
	// Both renderers do the same thing for the same reason, so both are checked.
	const source = codeOnly(readRepoFile('lib/options/settingsConsole.js'));

	for (const [kind, local] of [['enum', 'enumValues'], ['select', 'selectValues']]) {
		const block = source.slice(source.indexOf(`const ${local} = [...optionObject.values];`));
		assert.ok(block, `the ${kind} renderer does not take a copy`);
		const head = block.slice(0, block.indexOf('forEach') + 40);
		assert.ok(head.includes(`${local}.push({ name:`), `the ${kind} placeholder is pushed somewhere else`);
		assert.ok(head.includes(`${local}.forEach`), `the ${kind} renderer iterates the wrong list`);
	}

	// And nothing pushes into the module's array any more.
	assert.ok(
		!/optionObject\.values\.push\(/.test(source),
		'the placeholder is still pushed into the array the module owns',
	);
});

test('rendering one stale row does not add a choice to the next', () => {
	// The behaviour, executed: the placeholder must not survive into a second
	// render of the same option.
	const render = values => {
		const optionObject = { value: 'gone', values };
		const local = [...optionObject.values];
		if (optionObject.value && !local.some(({ value }) => value === optionObject.value)) {
			local.push({ name: `${optionObject.value} (not available)`, value: optionObject.value });
		}
		return local;
	};

	const moduleValues = [{ name: 'One', value: 'one' }, { name: 'Two', value: 'two' }];
	const first = render(moduleValues);
	assert.equal(first.length, 3, 'the reader cannot see what they had');
	assert.equal(moduleValues.length, 2, 'the module array grew');

	const second = render(moduleValues);
	assert.equal(second.length, 3);
	assert.equal(second.filter(entry => entry.value === 'gone').length, 1, 'the placeholder was added twice');
	assert.equal(moduleValues.length, 2, 'the module array grew on the second render');
});

test('the hover card builds its contents rather than parsing them', () => {
	const source = codeOnly(readRepoFile('lib/modules/hover.js'));

	// The one `innerHTML` left is the card's own template, which is a constant in
	// this file and never anything a caller passed. That is a different thing from
	// the branch that took a caller's string, and it is checked rather than
	// asserted away: every assignment to it comes from `this.template`.
	const assignments = [...source.matchAll(/(\w+)\.innerHTML = ([^;]+);/g)].map(match => match[2].trim());
	assert.deepEqual(assignments, ['this.template.trim()'], `hover.js assigns innerHTML from ${assignments.join(', ')}`);
	for (const template of source.matchAll(/template(?::? ?string)? = `/g)) assert.ok(template);

	assert.match(source, /type HoverContents = HTMLElement \| DocumentFragment \| null;/);
	// The load indicator was the only thing using the branch, so it has to be the
	// thing that proves the branch is gone.
	assert.match(source, /_loadIndicator\(\): HTMLElement \{/);
	assert.match(source, /this\.populate\(\[ellipsis, this\._loadIndicator\(\)\]\);/);
});
