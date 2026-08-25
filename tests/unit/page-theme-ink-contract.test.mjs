// Which page-theme palettes get the dark ink tokens.
//
// `_tokens.scss` carries two sets of `--rsm-ink-*` values: dark text for a light
// page in `:root`, and light text for a dark page in a second block. That second
// block was selected by a bare `html.res-pageTheme`, and `desiredThemeClasses`
// puts `res-pageTheme` on the root for *every* palette including the shipped
// default, Classic Reddit, whose `--rsm-th-bg` is `#fff`.
//
// So the most ordinary configuration there is - theme on, palette untouched -
// painted `#e9f0f8` ink on a white page. That is 1.06:1, and it reached the
// inline chips in fifteen module stylesheets. `inline-chip-contrast-contract`
// could not see it: that file checks each ink against its own ground and takes
// as given that `html.res-pageTheme` means a dark ground, which is the exact
// assumption that was wrong.
//
// `--rsm-th-scheme` is already the per-palette source of truth for light versus
// dark, so this derives the light list from it rather than restating one.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const pageTheme = read('lib/css/modules/_pageTheme.scss');
const tokens = read('lib/css/_tokens.scss');

// Every `html.res-pageTheme--<id> { ... }` palette block, with its scheme.
function palettes() {
	const found = new Map();
	const blocks = pageTheme.matchAll(/html\.res-pageTheme--([a-z]+)\s*\{([\s\S]*?)\n\}/g);
	for (const [, id, body] of blocks) {
		const scheme = /--rsm-th-scheme:\s*(\w+);/.exec(body);
		if (scheme) found.set(id, scheme[1]);
	}
	return found;
}

// The selector list that opens the dark-ink block.
function darkInkSelector() {
	const m = /\n((?:[^\n{]*\n)*?[^\n{]*)\{\s*\n\s*--rsm-ink:\s*#e9f0f8;/.exec(tokens);
	assert.ok(m, 'could not find the dark ink block in _tokens.scss');
	return m[1].trim();
}

test('every palette declares a colour scheme', () => {
	const found = palettes();
	assert.ok(found.size >= 11, `expected the full palette set, found ${found.size}`);
	for (const [id, scheme] of found) {
		assert.ok(['light', 'dark'].includes(scheme), `${id} declares scheme "${scheme}"`);
	}
});

test('classic is a light palette, and it is not the only thing keeping it out', () => {
	const found = palettes();
	assert.equal(found.get('classic'), 'light');
	// If this ever stops being true the exclusion below is dead weight rather
	// than wrong, and the next test is the one that matters.
	assert.ok([...found.values()].includes('dark'), 'there must be dark palettes too');
});

test('no light palette receives the dark ink tokens', () => {
	const selector = darkInkSelector();
	const light = [...palettes()].filter(([, scheme]) => scheme === 'light').map(([id]) => id);
	assert.ok(light.length > 0, 'there is at least one light palette to exclude');

	for (const id of light) {
		// One form only. An earlier version of this accepted
		// `:not(.res-pageTheme--classic)` OR the bare `.res-pageTheme--classic)`,
		// and the second is implied by the first *and* satisfied by the exact
		// inversion `:is(.res-pageTheme--classic)` - an assertion nothing could
		// fail.
		assert.ok(
			selector.includes(`:not(.res-pageTheme--${id})`),
			`palette "${id}" is light, but the dark ink block does not exclude it:\n  ${selector}`,
		);
		assert.ok(
			!new RegExp(`:is\\([^)]*res-pageTheme--${id}`).test(selector),
			`palette "${id}" is matched rather than excluded:\n  ${selector}`,
		);
	}
});

test('every dark palette still receives them', () => {
	const selector = darkInkSelector();
	const dark = [...palettes()].filter(([, scheme]) => scheme === 'dark').map(([id]) => id);
	assert.ok(selector.includes('html.res-pageTheme'), 'the block must still apply under the theme at all');
	for (const id of dark) {
		assert.ok(
			!selector.includes(`:not(.res-pageTheme--${id})`),
			`palette "${id}" is dark but is excluded from the dark ink block`,
		);
	}
	// nightMode is the legacy dark skin and defines no `--rsm-th-*` at all, so it
	// has to stay in this selector or its chips lose their ink entirely.
	assert.ok(selector.includes('body.res-nightmode'), 'nightMode must keep the dark inks');
});

test('the nightMode arm is guarded by whatever repaints the surface under it', () => {
	// This is the combination the browser found and no amount of reading the
	// stylesheet would have. nightMode is on by default and its class lands on
	// `<body>`, so which of the two actually paints the surface behind an inline
	// chip is decided by a *layout* toggle: `refinedLayout` is on by default and
	// its `html.res-pageTheme.res-pageTheme--refined .comment` rule is (0,3,1)
	// with `!important`, which outranks nightMode's (0,3,0) `!important`. Turn
	// the refined layout off and nightMode wins instead.
	//
	// So with the light Classic palette and nightMode both on, the same chip sits
	// on white with refined on and on #161616 with it off. Measured at 17.4:1 and
	// 1.04:1. Gating the nightMode arm on the palette alone fixed the first and
	// broke the second; it has to key on the same thing the ground does.
	const selector = darkInkSelector();
	assert.match(selector, /html:not\(\.res-pageTheme--refined\)[^,]*body\.res-nightmode/,
		`the nightMode arm is not gated on the refined layout:\n  ${selector}`);
});

test('the light palette carries a light page colour, so the two agree', () => {
	// The bug was a disagreement between two files. Assert they still agree
	// rather than assuming: classic paints white, so `:root`'s dark ink is right
	// for it, and `--rsm-page` in `:root` is white to match.
	const classic = /html\.res-pageTheme--classic\s*\{([\s\S]*?)\n\}/.exec(pageTheme);
	assert.ok(classic);
	assert.match(classic[1], /--rsm-th-bg:\s*#fff;/);

	const root = /\n:root\s*\{([\s\S]*?)\n\}/.exec(tokens);
	assert.ok(root);
	assert.match(root[1], /--rsm-page:\s*#fff;/);
	assert.match(root[1], /--rsm-ink:\s*#1a1a1b;/);
});
