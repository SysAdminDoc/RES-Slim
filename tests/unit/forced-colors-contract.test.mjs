// A state drawn with a property the UA deletes is a state that does not exist.
//
// In forced-colors mode the UA drops `box-shadow` outright and drops any
// `background-image` that is not a `url()`. This codebase draws almost
// everything with exactly those two properties, so the mode where a restyler can
// make a page *worse* than not running is this one: a spam comment renders like
// any other comment, an over-18 thumbnail loses its stripes, and a row whose
// button is one click from wiping a store loses the bar that said so.
//
// `_tokens.scss` and `options.scss` already restate the affordances that matter,
// and one e2e measures the result in a real engine, which is the only place
// forced-colors can be observed at all. What neither can do is fail when the
// *next* state-carrying rule is written. This does.
//
// The rule it enforces: if a declaration of a dropped property sits under a
// selector that names a state, then that state's own token must appear somewhere
// inside a `@media (forced-colors: active)` block. Anything else needs a line in
// `ACCEPTED` saying why, which is a deliberate cost — the point is that skipping
// one is a decision someone wrote down.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import scss from 'postcss-scss';
import { repoRoot } from './helpers/loadFlowModule.mjs';

const STYLE_ROOTS = [path.join(repoRoot, 'lib', 'css'), path.join(repoRoot, 'lib', 'options')];

// Tokens that mean "this element is in a particular state", as opposed to
// "this element is a panel". Kept narrow on purpose: a token that matches
// decoration produces noise, and noise is how a contract gets deleted.
const STATE_TOKENS = [
	'.spam',
	'.over18',
	'.spoiler',
	'.expanded',
	'.collapsed',
	'.is-active',
	'.active',
	'.enabled',
	'.selected',
	'.remove',
	':checked',
	'[data-armed',
	'[data-state',
	'[aria-pressed',
	'[aria-selected',
	'-error',
	'-danger',
	'-warning',
];

// Each entry is a decision, not a suppression. `reason` is printed when the
// entry stops matching anything, so an accepted rule that gets deleted or fixed
// does not quietly leave a stale exemption behind.
const ACCEPTED = [
	{
		file: 'lib/css/modules/_pageTheme.scss',
		token: '.collapsed',
		reason: 'A fade to the panel colour over a collapsed search result. It is decoration on a container whose own edge survives, not the marker that says the result is collapsed - the truncated text is.',
	},
	{
		file: 'lib/css/res.scss',
		token: '.remove',
		reason: 'Subscribe against unsubscribe on the fancy toggle button. The gradient is not the only marker: `fancyToggleButton` writes `+text` or `-text` into the element, so the state is in the label and survives every colour being forced.',
	},
];

function listStyles() {
	const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.name.endsWith('.scss') ? [full] : [];
	});
	return STYLE_ROOTS.filter(dir => fs.existsSync(dir)).flatMap(walk);
}

function relative(file) {
	return path.relative(repoRoot, file).replace(/\\/g, '/');
}

// Every selector written inside a forced-colors block, from every stylesheet,
// as one string. Membership is asked by substring because the restatement does
// not have to repeat the whole original selector - it has to name the state.
const forcedColorsSelectors = [];
const findings = [];

for (const file of listStyles()) {
	const ast = scss.parse(fs.readFileSync(file, 'utf8'), { from: file });

	ast.walkAtRules(atRule => {
		if (!/forced-colors\s*:\s*active/.test(atRule.params || '')) return;
		atRule.walkRules(rule => forcedColorsSelectors.push(rule.selector));
	});

	ast.walkDecls(decl => {
		const prop = decl.prop.toLowerCase();
		if (prop !== 'box-shadow' && prop !== 'background-image') return;

		const value = decl.value.toLowerCase();
		// `none` removes nothing, and a `url()` background survives the mode - the
		// UA drops only the generated ones.
		if (value === 'none' || value.includes('url(')) return;

		let insideForcedColors = false;
		const chain = [];
		let node = decl.parent;
		while (node) {
			if (node.type === 'atrule' && /forced-colors/.test(node.params || '')) insideForcedColors = true;
			if (node.type === 'rule') chain.unshift(node.selector.replace(/\s+/g, ' '));
			node = node.parent;
		}
		if (insideForcedColors) return;

		const selector = chain.join(' ');
		for (const token of STATE_TOKENS) {
			if (selector.includes(token)) {
				findings.push({ file: relative(file), line: decl.source.start.line, token, prop, selector });
			}
		}
	});
}

const forcedColorsText = forcedColorsSelectors.join('\n');

function isAccepted(finding) {
	return ACCEPTED.some(entry => entry.file === finding.file && entry.token === finding.token);
}

test('the stylesheets really were parsed, or every assertion below is vacuous', () => {
	// The failure this guards against is a glob that stops matching. Without it,
	// renaming `lib/css/` would turn this file into 5 green tests measuring an
	// empty list.
	assert.ok(listStyles().length > 30, `expected the stylesheet tree, found ${listStyles().length} files`);
	assert.ok(findings.length > 0, 'this codebase draws state with dropped properties; finding none means the walk is broken');
	assert.ok(forcedColorsSelectors.length > 10, 'the forced-colors blocks should be found too');
});

test('every state drawn with a dropped property is restated for forced colours', () => {
	const uncovered = findings
		.filter(finding => !forcedColorsText.includes(finding.token))
		.filter(finding => !isAccepted(finding));

	assert.deepEqual(
		uncovered,
		[],
		`These rules carry a state in a property forced-colors deletes, and no forced-colors block names that state:\n${
			uncovered.map(f => `  ${f.file}:${f.line} ${f.prop} on ${f.selector} (state token ${f.token})`).join('\n')
		}\nRestate the state in a forced-colors block, or add it to ACCEPTED with a reason.`,
	);
});

test('the four states this pass fixed each have a forced-colours restatement', () => {
	// Named individually rather than counted. A count passes when one is replaced
	// by another; these are the specific defects that were shipped.
	for (const token of ['.spam', '.spoiler', '.over18', '[data-armed=\'1\']']) {
		assert.ok(forcedColorsText.includes(token), `${token} lost its forced-colours restatement`);
	}
});

test('a restatement uses a system colour, because an author colour is exactly what gets forced away', () => {
	const SYSTEM_COLOURS = ['Highlight', 'CanvasText', 'ButtonBorder', 'ButtonText', 'Mark', 'LinkText', 'GrayText'];
	const offenders = [];

	for (const file of listStyles()) {
		const ast = scss.parse(fs.readFileSync(file, 'utf8'), { from: file });
		ast.walkAtRules(atRule => {
			if (!/forced-colors\s*:\s*active/.test(atRule.params || '')) return;
			atRule.walkDecls(decl => {
				// Widths and offsets may still come from tokens. Only the properties
				// that carry a colour are under test.
				if (!/^(outline|outline-color|border|border-color|background|background-color|color)$/.test(decl.prop)) return;
				if (decl.value === 'none') return;
				if (SYSTEM_COLOURS.some(colour => decl.value.includes(colour))) return;
				offenders.push(`${relative(file)}:${decl.source.start.line} ${decl.prop}: ${decl.value}`);
			});
		});
	}

	assert.deepEqual(offenders, [], `forced-colors declarations must resolve to a system colour:\n${offenders.join('\n')}`);
});

test('every accepted exemption still describes something that exists', () => {
	// A stale exemption is worse than none: it reads as "someone considered this"
	// when the rule it excused was deleted three versions ago.
	for (const entry of ACCEPTED) {
		assert.ok(
			findings.some(finding => finding.file === entry.file && finding.token === entry.token),
			`ACCEPTED names ${entry.file} / ${entry.token}, which no longer matches any rule. Delete the entry. Its reason was: ${entry.reason}`,
		);
		assert.ok(entry.reason.length > 40, `${entry.file} needs a real reason, not a label`);
	}
});
