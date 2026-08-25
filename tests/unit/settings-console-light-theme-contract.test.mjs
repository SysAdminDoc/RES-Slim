// The one light settings theme, and the tokens a dark-authored rule forgets.
//
// `settings-console-contrast` already holds the text and control-boundary tokens
// to WCAG per theme, and it passes. It could not see any of the following,
// because every one of them was a *literal* at the call site rather than a
// token, and a literal is invisible to a token contract:
//
//   * the toggle's moving knob was `#fff` against a track painted
//     `var(--options-field)`, which is `#fff` on the light theme. Measured 1.0:1
//     in a real browser: a boolean option had no visible off state at all, while
//     the on state was fine, which is how it survived being looked at.
//   * the module state badge, the ADVANCED marker and the save bar's
//     unsaved/saved indicator were four lightened tones authored against a dark
//     panel.
//   * five fills were `rgb(255 255 255 / n%)`, which is a wash on a dark theme
//     and nothing at all on a light one - a count pill and an inline code chip
//     lost their shape, and three hover states gave no feedback.
//
// So this asserts the rule that would have prevented all of them: a colour that
// has to differ between a light and a dark console is a token, and every such
// token is redefined by the light theme.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const styles = fs.readFileSync(path.join(repoRoot, 'lib', 'options', 'options.scss'), 'utf8');

function block(selector) {
	const index = styles.indexOf(selector);
	assert.notEqual(index, -1, `${selector} is missing from options.scss`);
	const open = styles.indexOf('{', index);
	const close = styles.indexOf('\n}', open);
	return styles.slice(open, close);
}

const root = block(':root {');

// Every theme block, keyed by id, with its declared color-scheme.
function themes() {
	const found = new Map();
	for (const [, id] of styles.matchAll(/html\[data-settings-theme='([a-z]+)'\]\s*\{/g)) {
		const body = block(`html[data-settings-theme='${id}'] {`);
		const scheme = /color-scheme:\s*(\w+);/.exec(body);
		found.set(id, { body, scheme: scheme ? scheme[1] : 'dark' });
	}
	return found;
}

// Tokens whose correct value depends on whether the console is light or dark.
const POLARISED = [
	'--options-knob',
	'--options-success-text',
	'--options-warning-text',
	'--options-warning-text-strong',
	'--options-danger-text',
];

test('there is at least one light theme, or this file checks nothing', () => {
	const light = [...themes()].filter(([, t]) => t.scheme === 'light');
	assert.ok(light.length > 0, 'no theme declares color-scheme: light');
});

test('every polarised token is defined by the dark default', () => {
	for (const token of POLARISED) {
		assert.match(root, new RegExp(`${token}:\\s*[^;]+;`), `${token} is missing from :root`);
	}
});

test('every light theme redefines every polarised token', () => {
	const missing = [];
	for (const [id, theme] of themes()) {
		if (theme.scheme !== 'light') continue;
		for (const token of POLARISED) {
			if (!new RegExp(`${token}:\\s*[^;]+;`).test(theme.body)) missing.push(`${id} -> ${token}`);
		}
	}
	assert.deepEqual(missing, [], `a light theme inherits a dark-only value:\n  ${missing.join('\n  ')}`);
});

test('no rule paints with a bare white alpha fill', () => {
	// `rgb(255 255 255 / n%)` as a background or a border is a dark-theme idiom.
	// The two remaining uses are inset highlight sheens, which are decoration
	// either way; a background or a border carries shape, and shape has to exist
	// in both directions.
	const offenders = styles.split(/\r?\n/)
		.map((line, index) => ({ line, number: index + 1 }))
		.filter(({ line }) => !/^\s*\/\//.test(line))
		.filter(({ line }) => /rgb\(255 255 255 \/ \d+%\)/.test(line))
		.filter(({ line }) => !/box-shadow/.test(line))
		.filter(({ line }) => /^(background|border)\b/.test(line.trim()))
		.map(({ line, number }) => `${number}: ${line.trim()}`);
	assert.deepEqual(offenders, [], `white-alpha fills that vanish on a light theme:\n  ${offenders.join('\n  ')}`);
});

test('the knob and the status tones are read from tokens, not written as literals', () => {
	// The literals that were there. Finding any of them again means a call site
	// went back to hardcoding, which is what put them out of the reach of every
	// contrast contract in the first place.
	for (const literal of ['#b5f4bf', '#f8df91', '#ffb7b1']) {
		const uses = styles.split(literal).length - 1;
		assert.ok(uses <= 1, `${literal} appears ${uses} times; it belongs only in a token definition`);
	}
	// The knob reads its token rather than painting white.
	const knobRule = styles.slice(styles.indexOf('.toggleThumb {'), styles.indexOf('.toggleThumb {') + 900);
	assert.match(knobRule, /background:\s*var\(--options-knob\)/);
});

test('the breadcrumb separator uses a text token, not a decoration one', () => {
	// `--options-border-strong` is a panel-divider colour. As the "/" between
	// breadcrumb items it measured 1.3-2.5:1 in all eleven themes, so the trail
	// rendered as one run-on word. `--options-text-soft` is held to 4.5:1 per
	// theme by `settings-console-contrast`.
	const rule = styles.slice(styles.indexOf('.consoleBreadcrumbSeparator {'));
	const declaration = rule.slice(0, rule.indexOf('}'));
	assert.match(declaration, /color:\s*var\(--options-text-soft\)/);
});
