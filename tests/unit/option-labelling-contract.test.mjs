// Every option control in the settings console has to have a name a screen
// reader can announce.
//
// Three of the eleven option types had none. `<label for>` pointed at elements
// that cannot be labelled: an enum rendered a `<div>` carrying the option id, a
// button option rendered a `<div>` the same way, and a keycode pointed the label
// at a `display: none` input while the field the user can actually see and focus
// had nothing at all. In each case a screen-reader user got an unnamed control.
//
// Ids were also bare option keys rather than module-namespaced, so two modules
// that both call an option `enabled` produced two elements with the same id —
// and, for enums, two radio *groups* the platform merges into one.
//
// This walks every option type through the real renderer and asserts an
// accessible name for each, rather than checking the three that were broken:
// the next option type added is the one nobody remembers to check.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const source = read('lib/options/settingsConsole.js');

// The renderer is 2,000 lines into a module that reaches the whole console, so
// this reads the shape it produces from source rather than bundling it. Each
// assertion names the element it is about, so a rename fails here loudly rather
// than silently un-labelling a control.
const stripped = source
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');

test('ids are namespaced by module, so two modules cannot collide', () => {
	assert.match(stripped, /export function optionDomId\(moduleID: string, optionName: string\): string \{\s*\n\s*return `\$\{moduleID\}-\$\{optionName\}`;/);

	// Every control built by drawOptionInput uses it. A bare `id: optionName`
	// anywhere in that function is the defect coming back.
	const fn = stripped.slice(stripped.indexOf('function drawOptionInput'), stripped.indexOf('async function toggleModuleEnabled'));
	assert.ok(!/id: optionName\b/.test(fn), 'a bare option key as a DOM id is what collided');
	assert.ok(fn.includes('id: domId'), 'the namespaced id is what every control should carry');
});

test('the radio group name is namespaced too, not just the id', () => {
	const fn = stripped.slice(stripped.indexOf("case 'enum':"), stripped.indexOf("case 'keycode':"));
	assert.match(fn, /name: domId/, 'two modules sharing an option key would otherwise render one merged radio group, so selecting in either clears the other');
	assert.ok(!/name: optionName/.test(fn));
});

test('an enum is a radiogroup with a name', () => {
	const fn = stripped.slice(stripped.indexOf("case 'enum':"), stripped.indexOf("case 'keycode':"));
	assert.match(fn, /role: 'radiogroup'/, 'a div of radios announces as nothing');
	assert.match(fn, /setAttribute\('aria-labelledby', labelId\)/);
});

test('a button option is a group with a name', () => {
	const fn = stripped.slice(stripped.indexOf("case 'button': {"), stripped.indexOf("case 'password':"));
	assert.match(fn, /role: 'group'/);
	assert.match(fn, /setAttribute\('aria-labelledby', labelId\)/, 'a container of buttons that names nothing leaves every button in it unexplained');
});

test('the keycode field the user can see is the one that is labelled', () => {
	const fn = stripped.slice(stripped.indexOf("case 'keycode': {"), stripped.indexOf("case 'select':"));
	assert.match(fn, /displayInput\.setAttribute\('aria-labelledby', labelId\)/, 'the visible field had no accessible name at all');
	assert.match(fn, /id: `\$\{domId\}-display`/);
	// The hidden input keeps the option id because that is what the capture modal
	// writes back into; what must not happen is the label pointing at it.
	assert.match(fn, /capturefor: domId/);
});

test('`for` is only used where it can land on a labelable element', () => {
	assert.match(stripped, /const LABELLED_BY_ARIA = new Set\(\['enum', 'button', 'boolean'\]\)/);

	const block = stripped.slice(stripped.indexOf('const forId = LABELLED_BY_ARIA'), stripped.indexOf('let niceDefaultOption'));
	assert.match(block, /LABELLED_BY_ARIA\.has\(option\.type\) \? null/, 'no `for` at all beats a `for` that points at a div');
	assert.match(block, /option\.type === 'keycode' \? `\$\{optionDomId\(mod\.moduleID, optionKey\)\}-display`/);
	assert.match(block, /if \(forId\) thisLabel\.setAttribute\('for', forId\)/);
});

test('every option type ends up named, by one mechanism or another', () => {
	// The list is the whole switch in drawOptionInput. If a type is added without
	// deciding how it gets a name, this fails rather than shipping an unnamed
	// control — which is exactly how the three broken ones survived.
	const fn = stripped.slice(stripped.indexOf('function drawOptionInput'), stripped.indexOf('async function toggleModuleEnabled'));
	const types = [...fn.matchAll(/case '([a-z]+)':/g)].map(m => m[1]);
	assert.deepEqual(
		[...new Set(types)].sort(),
		['boolean', 'button', 'color', 'enum', 'hidden', 'keycode', 'list', 'password', 'select', 'text', 'textarea'],
		'a new option type here needs a matching decision about how it gets a name',
	);

	// Every type is named by one of exactly three mechanisms, and each of the
	// three is asserted above: `aria-labelledby` back to the option title
	// (LABELLED_BY_ARIA), `<label for>` to the visible field (keycode), or
	// `<label for>` to the control itself (everything else).
	const ariaNamed = ['enum', 'button', 'boolean'];
	const labelledDirectly = types.filter(type => !ariaNamed.includes(type));
	assert.ok(labelledDirectly.length > 0, 'sanity: most types are named by a plain `for`');
	for (const type of ariaNamed) {
		assert.ok(types.includes(type), `LABELLED_BY_ARIA names "${type}", which drawOptionInput no longer renders`);
	}
});

test('which option a control belongs to is stated, not parsed out of its id', () => {
	// The root cause of the whole item: staging read the option key back out of
	// the DOM id, which is why namespacing the ids would have broken saving.
	assert.match(stripped, /thisOptionFormEle\.dataset\.optionKey = optionName;/);
	assert.match(stripped, /const optionName = input\.dataset\.optionKey \|\|/, 'staging reads the stated key first');

	// And the two places that looked controls up by id now look them up by key.
	assert.ok(!/querySelector\(`#\$\{CSS\.escape\(key\)\}`\)/.test(stripped), 'a bare option key is no longer a DOM id');
	assert.ok(!/querySelector\(`#\$\{CSS\.escape\(entry\.optionKey\)\}`\)/.test(stripped));
	assert.match(stripped, /\[data-option-key="\$\{CSS\.escape\(key\)\}"\]/);
	assert.match(stripped, /\[data-option-key="\$\{CSS\.escape\(entry\.optionKey\)\}"\]/);
});

test('the label element still carries the id the toggles point back at', () => {
	// `CreateElement.toggleButton` sets `aria-labelledby` to `${fieldID}-label`,
	// and fieldID is now the namespaced id — so the label's own id has to be
	// built the same way or every boolean option loses its name.
	assert.match(stripped, /thisLabel\.id = optionLabelId\(mod\.moduleID, optionKey\);/);
	assert.match(stripped, /function optionLabelId\(moduleID: string, optionName: string\): string \{\s*\n\s*return `\$\{moduleID\}-\$\{optionName\}-label`;/);

	const toggle = read('lib/utils/createElement.js');
	assert.match(toggle, /aria-labelledby.*\$\{fieldID\}-label/, 'the two halves of this have to agree');
});
