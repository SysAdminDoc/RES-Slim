import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

// Two rules this project states about itself, held to the code.
//
// Both were previously written in a form the shipped code contradicts — "no
// external network calls outside Reddit/redditstatic" against a build that talks
// to PullPush, Arctic Shift, the Wayback Machine, Cobalt, rimgo, five
// reverse-image engines and localhost; "no keyboard shortcuts" against seven
// bound `keycode` options. A rule the code violates cannot be used to judge the
// next change, so each is restated as the true, narrower thing and checked here.

const MODULES_DIR = path.join(repoRoot, 'lib', 'modules');

function moduleFiles() {
	return fs.readdirSync(MODULES_DIR).filter(name => name.endsWith('.js'));
}

test('every keycode option is a modifier combination, never a bare key', () => {
	// The real rule. `[keyCode, alt, ctrl, shift, meta]` — a default with no
	// modifier set would steal a plain letter from reddit's own page and from the
	// user's browser, which is what "no keyboard shortcuts" was reaching for.
	const KEYCODE = /type: 'keycode',\s*\n\s*value: \[(\d+), (true|false), (true|false), (true|false), (true|false)\]/g;

	const found = [];
	for (const name of moduleFiles()) {
		const source = read(`lib/modules/${name}`);
		for (const match of source.matchAll(KEYCODE)) {
			const [, keyCode, alt, ctrl, shift, meta] = match;
			const modifiers = [alt, ctrl, shift, meta].filter(flag => flag === 'true');
			found.push({ module: name, keyCode: Number(keyCode), modifiers: modifiers.length });
		}
	}

	// Seven standalone bindings. The eighth `type: 'keycode'` in the tree is a
	// *field* of the macros table, and the two rows that ship leave it undefined —
	// so a reader can bind a macro to a key, and none arrives bound.
	assert.equal(found.length, 7, `expected the shipped keycode bindings, found ${found.length}`);
	const macros = read('lib/modules/commentTools.js');
	assert.match(macros, /\['reddiquette', '[^']*', undefined, undefined\]/,
		'the fourth column is the keycode of a macro row, and every shipped row leaves it unbound');
	assert.match(macros, /\['Current timestamp', '\{\{now\}\} ', undefined, undefined\]/);
	const bare = found
		.filter(entry => entry.modifiers === 0)
		.map(entry => `${entry.module}: keyCode ${entry.keyCode} with no modifier`);
	assert.deepEqual(bare, [], `single-key shortcuts bound by default:\n  ${bare.join('\n  ')}`);

	// And they live only where a text editor's conventions belong.
	const owners = [...new Set(found.map(entry => entry.module))].sort();
	assert.deepEqual(owners, ['commentPreview.js', 'commentTools.js'],
		'a keycode option outside the comment composer needs the shortcut rule revisited');
});

test('no non-Reddit request fires without a user action or an opted-in setting', () => {
	// Every module that reaches a third-party host. Each is either disabled by
	// default, or default-on but request-free until the reader clicks.
	const ALWAYS_ON_BUT_INERT = {
		// Renders archive buttons. Opening one is a navigation the reader chose;
		// the module itself issues no request, which is what this asserts.
		'archiveLinks.js': { reason: 'renders links only', mustNotImport: true },
		// Adds a click-to-restore link per removed comment. `autoLoad` turns the
		// fetching on and defaults to false.
		'viewDeleted.js': { reason: 'click-to-restore; autoLoad defaults false', gate: 'autoLoad' },
	};

	const OUTBOUND = [
		'viewDeleted.js', 'archiveLinks.js', 'waybackSnapshot.js', 'cobaltDownloader.js',
		'imgurFlatten.js', 'reverseImageSearch.js', 'localCompanion.js', 'arcticShift.js',
		'editedCommentDiff.js',
	];

	const violations = [];
	for (const name of OUTBOUND) {
		const source = read(`lib/modules/${name}`);
		const inert = ALWAYS_ON_BUT_INERT[name];

		if (!inert) {
			if (!/module\.disabledByDefault = true;/.test(source)) {
				violations.push(`${name} reaches a third party and is enabled by default`);
			}
			continue;
		}

		if (inert.mustNotImport && /\bajax\b|\bfetch\(/.test(source)) {
			violations.push(`${name} is exempt as "${inert.reason}" but now issues requests`);
		}
		if (inert.gate) {
			// The gate has to still exist and still default to off.
			const gate = new RegExp(`${inert.gate}: \\{[\\s\\S]{0,200}?value: (true|false)`);
			const match = gate.exec(source);
			if (!match) violations.push(`${name}: the ${inert.gate} option is gone`);
			else if (match[1] !== 'false') violations.push(`${name}: ${inert.gate} now defaults to ${match[1]}`);
		}
	}

	assert.deepEqual(violations, [], `outbound rule violations:\n  ${violations.join('\n  ')}`);
});

test('the stated rules say what the code does', () => {
	const claude = read('CLAUDE.md');

	// The network rule names its enforcement. A rule with no named check is the
	// shape this repo has produced five times now.
	assert.match(claude, /no outbound request to a non-Reddit host/i);
	assert.match(claude, /privacy-outbound-urls/);

	// And the shortcut rule is the narrow true one, not the absolute false one.
	assert.match(claude, /no global or single-key shortcuts/i);

	// The two notes that were describing a build from before v0.40.0.
	assert.doesNotMatch(claude, /contains a hardcoded Google API key/);
	assert.doesNotMatch(claude, /Other locale files/);
});
