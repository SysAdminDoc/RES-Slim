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

// Every declaration in the sheet, with the selector chain it actually lands on.
//
// A regex over flat `selector { … }` text cannot do this, and the first version
// of this file tried: `#RESConsoleContainer` is also a nesting *parent* here, so
// `#RESConsoleContainer { select { color-scheme: dark; } }` is the same shipped
// bug in the most natural SCSS spelling and matched nothing.
//
// Quotes are tracked because a `}` inside a string would otherwise close a block
// that is still open, and every chain after it would be wrong; `//` is only a
// comment when it does not follow a colon, because `url(https://…)` is not the
// start of one.
function declarations(source) {
	const found = [];
	const stack = [];
	let buffer = '';
	let index = 0;
	let quote = null;
	while (index < source.length) {
		const char = source[index];
		if (quote) {
			if (char === '\\') { buffer += source.slice(index, index + 2); index += 2; continue; }
			if (char === quote) quote = null;
			buffer += char;
			index += 1;
			continue;
		}
		if (char === '"' || char === '\'') { quote = char; buffer += char; index += 1; continue; }
		const two = source.slice(index, index + 2);
		if (two === '//' && source[index - 1] !== ':') {
			const end = source.indexOf('\n', index);
			if (end === -1) break;
			index = end;
			continue;
		}
		if (two === '/*') {
			const end = source.indexOf('*/', index + 2);
			index = end === -1 ? source.length : end + 2;
			continue;
		}
		if (char === '{') {
			stack.push(buffer.trim().replace(/\s+/g, ' '));
			buffer = '';
		} else if (char === '}') {
			stack.pop();
			buffer = '';
		} else if (char === ';') {
			const text = buffer.trim();
			// `@use`, `@import` and friends are statements, not declarations.
			if (text && !text.startsWith('@')) found.push({ chain: [...stack], text });
			buffer = '';
		} else {
			buffer += char;
		}
		index += 1;
	}
	return found;
}

// The two places a scheme may be declared, and nowhere else.
const SCHEME_OWNER = /^(:root|html\[data-settings-theme='[a-z]+'\])$/;

test('only the root and the theme blocks declare a colour scheme', () => {
	// The scheme is declared once on `:root` and once per theme, so it follows
	// whichever theme the reader picked. `#RESConsoleContainer select, textarea`
	// said `dark`, which beat that in one direction only, so the Paper theme drew
	// dark UA popups, scrollbars and carets inside a light console. That is the
	// default install, not an edge case: `DEFAULT_SETTINGS_THEME` is `system`,
	// which resolves to Paper on a light desktop. The data-set dropdown, the
	// account picker, the selector-override editor and the support-report box all
	// take their native chrome from it.
	//
	// Stated as "only these two selectors may declare one", rather than as "no
	// rule under the console may". The narrower version had two holes: it matched
	// the declaration with an anchored pattern, so `color-scheme: dark !important`
	// -- the likeliest spelling of exactly this override -- slipped through; and
	// it keyed on the chain containing `#RESConsoleContainer`, so the same
	// declaration inside a `@mixin` that the console `@include`s was invisible.
	// This owner rule has neither hole, because it looks at every `color-scheme`
	// in the file and asks where it is.
	const offenders = declarations(styles)
		.filter(({ text }) => /^color-scheme\s*:/.test(text))
		.filter(({ chain, text }) => {
			const owner = chain[chain.length - 1] || '(top level)';
			if (SCHEME_OWNER.test(owner)) return false;
			// `inherit` is a no-op that documents intent, and is what the console's
			// own controls carry so the literal cannot come back by accident.
			return !/^color-scheme\s*:\s*inherit\s*$/.test(text);
		})
		.map(({ chain, text }) => `${chain.join(' / ') || '(top level)'} -> ${text}`);
	assert.deepEqual(offenders, [], `a scheme is declared somewhere it cannot follow the theme:\n  ${offenders.join('\n  ')}`);
});

test('the walker survives the constructs this stylesheet is allowed to contain', () => {
	// The positive controls for the gate above. Written against fixtures rather
	// than the real sheet, so they keep proving the walker works after the sheet
	// stops containing anything to find.
	const nested = '#RESConsoleContainer { display: grid; select, textarea { color-scheme: dark; } }';
	const inMixin = '@mixin console-bits { select { color-scheme: dark !important; } }';
	const withUrl = '.a { background: url(https://example.com/x.png); color-scheme: dark; }';
	const withBrace = '.b::after { content: "}"; color-scheme: dark; }';

	for (const [label, sheet] of [['nested', nested], ['mixin', inMixin], ['url', withUrl], ['brace', withBrace]]) {
		const schemes = declarations(sheet).filter(({ text }) => /^color-scheme\s*:/.test(text));
		assert.equal(schemes.length, 1, `${label}: the walker lost the declaration entirely`);
		const owner = schemes[0].chain[schemes[0].chain.length - 1] || '(top level)';
		assert.equal(SCHEME_OWNER.test(owner), false, `${label}: ${owner} must not read as an allowed owner`);
	}

	// And a comment still cannot smuggle one past it.
	assert.equal(declarations('.a { // color-scheme: dark;\n }').length, 0);
	assert.equal(declarations('.a { /* color-scheme: dark; */ }').length, 0);

	// The two allowed owners really are recognised, or the gate rejects the sheet
	// it is meant to accept.
	for (const owner of [':root', 'html[data-settings-theme=\'paper\']']) {
		const [only] = declarations(`${owner} { color-scheme: dark; }`);
		assert.equal(only.chain[only.chain.length - 1], owner);
		assert.ok(SCHEME_OWNER.test(owner), `${owner} has to be an allowed owner`);
	}
});

test('a theme whose page is light says so, rather than inheriting dark', () => {
	// The counterpart to the gate above: dropping the literal is only safe while
	// the root and the themes still declare a scheme, so `inherit` has something
	// to inherit. "At least one theme declares something" is not that check --
	// it passes on the day the light theme stops declaring one, which is the
	// exact regression, so the invariant is derived from each theme's own page
	// colour instead. The dark themes say nothing on purpose: they inherit
	// `:root`'s `dark`, and it is right for them.
	assert.match(root, /color-scheme:\s*dark;/, ':root has to carry the default scheme');

	const luminance = hex => {
		const body = hex.trim().replace('#', '');
		const full = body.length === 3 ? body.split('').map(c => c + c).join('') : body;
		const channels = [0, 2, 4].map(at => parseInt(full.slice(at, at + 2), 16) / 255);
		const linear = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
		return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
	};

	const wrong = [];
	let checked = 0;
	for (const [id, theme] of themes()) {
		const background = /--options-bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(theme.body);
		assert.ok(background, `theme "${id}" declares no --options-bg to judge it by`);
		checked += 1;
		const wantsLight = luminance(background[1]) > 0.5;
		const declared = /color-scheme:\s*(\w+);/.exec(theme.body);
		const scheme = declared ? declared[1] : 'dark (inherited from :root)';
		if (wantsLight !== scheme.startsWith('light')) wrong.push(`${id}: page ${background[1]} but scheme ${scheme}`);
	}
	assert.ok(checked > 1, 'the theme list must load, or this checks nothing');
	assert.deepEqual(wrong, [], `a theme's page colour and its colour scheme disagree:\n  ${wrong.join('\n  ')}`);
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
