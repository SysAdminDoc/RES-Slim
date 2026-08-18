// Every pageTheme palette has to be readable.
//
// The roadmap item that added Nord, Dracula, Gruvbox and Solarized Dark said each
// should "pass the existing WCAG AA contrast contract". There was no such contract
// for these palettes — `settings-console-contrast` covers the *console* themes,
// which are a different token set on a different surface. Six palettes had shipped
// unchecked, and four more were about to.
//
// A palette is seven CSS variables. The two that decide whether the page can be
// read are `--rsm-th-txt` and `--rsm-th-link`, both against `--rsm-th-bg`, and the
// same two against the raised surfaces a comment or sidebar sits on.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scss = fs.readFileSync(path.join(repoRoot, 'lib', 'css', 'modules', '_pageTheme.scss'), 'utf8');

const { PAGE_THEME_IDS } = await loadFlowModule('lib/utils/pageTheme.js', 'page-theme-contrast', { deps: ['lib/utils/usernameColors.js'] });

function hex(value) {
	// Both forms: OLED's background is written `#000`.
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
	assert.ok(m, `expected a hex colour, got ${value}`);
	const full = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
	const n = parseInt(full, 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// `hex()` above throws on anything that is not a hex triple, and eight of the ten
// palettes write `--rsm-th-border` as `rgba(...)`. That is why the borders were
// never measured: a parser that cannot read a value cannot fail on it either, so
// the gap looked like coverage. This reads both, and returns alpha so a
// translucent border can be composited onto the surface it is drawn over.
function color(value) {
	const trimmed = String(value).trim();
	if (trimmed.startsWith('#')) return [...hex(trimmed), 1];

	const m = /^rgba?\(\s*([^)]+)\)$/i.exec(trimmed);
	assert.ok(m, `expected a hex or rgb(a) colour, got ${value}`);
	const parts = m[1].split(/[\s,/]+/).filter(Boolean);
	const rawAlpha = parts[3];
	const alpha = rawAlpha === undefined ?
		1 :
		(rawAlpha.endsWith('%') ? Number(rawAlpha.slice(0, -1)) / 100 : Number(rawAlpha));
	return [Number(parts[0]), Number(parts[1]), Number(parts[2]), alpha];
}

// A translucent border is not the colour it declares — it is that colour mixed
// with whatever is behind it, which for these palettes is a dark surface. Ignore
// the alpha and every border reads three to eight times more contrasty than it
// paints.
function over([r, g, b, a], surface) {
	if (a >= 1) return [r, g, b];
	return [
		r * a + surface[0] * (1 - a),
		g * a + surface[1] * (1 - a),
		b * a + surface[2] * (1 - a),
	];
}

const channel = c => {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a, b) {
	const [l1, l2] = [luminance(a), luminance(b)];
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function palette(id) {
	const block = new RegExp(`html\\.res-pageTheme--${id}\\s*\\{([^}]*)\\}`).exec(scss);
	assert.ok(block, `no palette block for "${id}" — the enum lists it, so the stylesheet must define it`);

	const tokens = {};
	for (const [, name, value] of block[1].matchAll(/--(rsm-th-[a-z-]+):\s*([^;]+);/g)) {
		tokens[name] = value.trim();
	}
	return tokens;
}

// WCAG AA for body text. 3:1 (AA Large) is not enough here — reddit's comment
// text is 14px.
const AA = 4.5;

test('the contrast maths is right before anything is measured with it', () => {
	// Without this the whole file could be reporting 21:1 for everything.
	assert.equal(contrast(hex('#ffffff'), hex('#000000')).toFixed(0), '21');
	assert.equal(contrast(hex('#000000'), hex('#000000')).toFixed(0), '1');
	// A known AA failure: mid-grey on white is 4.0:1.
	assert.ok(contrast(hex('#949494'), hex('#ffffff')) < AA);
});

test('every palette in the enum has a stylesheet block', () => {
	assert.ok(PAGE_THEME_IDS.length >= 10, `expected the full palette set, saw ${PAGE_THEME_IDS.length}`);
	for (const id of PAGE_THEME_IDS) {
		const tokens = palette(id);
		for (const token of ['rsm-th-bg', 'rsm-th-bg-elev', 'rsm-th-bg-raise', 'rsm-th-txt', 'rsm-th-txt-strong', 'rsm-th-link', 'rsm-th-muted']) {
			assert.ok(tokens[token], `${id} is missing --${token}`);
		}
	}
});

test('body text clears AA on every surface of every palette', () => {
	const failures = [];

	for (const id of PAGE_THEME_IDS) {
		const t = palette(id);
		// A comment sits on the raised surface, not the page background, so checking
		// only against `bg` would miss the surface most text is actually read on.
		for (const surface of ['rsm-th-bg', 'rsm-th-bg-elev', 'rsm-th-bg-raise']) {
			for (const fg of ['rsm-th-txt', 'rsm-th-txt-strong']) {
				const ratio = contrast(hex(t[fg]), hex(t[surface]));
				if (ratio < AA) failures.push(`${id}: ${fg} on ${surface} is ${ratio.toFixed(2)}:1`);
			}
		}
	}

	assert.deepEqual(failures, [], `WCAG AA needs ${AA}:1 for body text`);
});

test('links clear AA on every surface of every palette', () => {
	// The one most likely to fail: a palette's accent hue is chosen for character,
	// and Solarized's canonical blue (#268bd2) measures 3.6:1 on its own background.
	const failures = [];

	for (const id of PAGE_THEME_IDS) {
		const t = palette(id);
		for (const surface of ['rsm-th-bg', 'rsm-th-bg-elev', 'rsm-th-bg-raise']) {
			const ratio = contrast(hex(t['rsm-th-link']), hex(t[surface]));
			if (ratio < AA) failures.push(`${id}: link on ${surface} is ${ratio.toFixed(2)}:1`);
		}
	}

	assert.deepEqual(failures, [], 'a link the user has to squint at is a defect, not a theme');
});

test('muted metadata still clears AA on every surface of every palette', () => {
	const failures = [];

	for (const id of PAGE_THEME_IDS) {
		const t = palette(id);
		for (const surface of ['rsm-th-bg', 'rsm-th-bg-elev', 'rsm-th-bg-raise']) {
			const ratio = contrast(hex(t['rsm-th-muted']), hex(t[surface]));
			if (ratio < AA) failures.push(`${id}: muted metadata on ${surface} is ${ratio.toFixed(2)}:1`);
		}
	}

	assert.deepEqual(failures, [], 'small metadata needs full body-text contrast');
});

test('the rgb(a) parser reads what the palettes actually write, and composites it', () => {
	// Guard for the border test below. Without this the helper could be silently
	// returning something plausible for a value it did not understand.
	assert.deepEqual(color('#abc'), [0xaa, 0xbb, 0xcc, 1]);
	assert.deepEqual(color('#abcdef'), [0xab, 0xcd, 0xef, 1]);
	assert.deepEqual(color('rgba(255, 255, 255, 0.09)'), [255, 255, 255, 0.09]);
	assert.deepEqual(color('rgb(0 0 0 / 28%)'), [0, 0, 0, 0.28]);
	assert.throws(() => color('color-mix(in srgb, red 50%, blue)'), /expected a hex or rgb\(a\) colour/);

	// White at 50% over black is mid-grey, not white.
	assert.deepEqual(over([255, 255, 255, 0.5], [0, 0, 0]), [127.5, 127.5, 127.5]);
	assert.deepEqual(over([1, 2, 3, 1], [0, 0, 0]), [1, 2, 3]);
});

test('the boundary of a form control clears WCAG 1.4.11 on every palette', () => {
	// 1.4.11 wants 3:1 for "visual information required to identify user interface
	// components". `--rsm-th-border` measures 1.17-1.48 once its alpha is
	// composited, which is fine for the card outlines and dividers it mostly draws
	// — those are decoration and exempt — but not for the edge that tells you where
	// a text field is. `--rsm-th-control-border` carries the controls.
	const failures = [];

	for (const id of PAGE_THEME_IDS) {
		const t = palette(id);
		assert.ok(t['rsm-th-control-border'], `${id} is missing --rsm-th-control-border`);
		for (const surfaceToken of ['rsm-th-bg', 'rsm-th-bg-elev', 'rsm-th-bg-raise']) {
			const surface = hex(t[surfaceToken]);
			const ratio = contrast(over(color(t['rsm-th-control-border']), surface), surface);
			if (ratio < 3) failures.push(`${id}: control border on ${surfaceToken} is ${ratio.toFixed(2)}:1`);
		}
	}

	assert.deepEqual(failures, [], 'a control boundary needs 3:1, or the control has no visible edge');
});

test('form controls take their boundary from the control token, not the decorative one', () => {
	// The split is the whole point: raising `--rsm-th-border` to 3:1 as well would
	// put a hard line around every card and divider and turn the page into a
	// wireframe. So the rules that style an actual input must name the other token.
	const controlRules = [
		/html\.res-pageTheme #search input\[type="text"\][\s\S]*?border-color: var\(--rsm-th-control-border\)/,
		/\.side #search input\[type="text"\] \{[\s\S]*?border: 1px solid var\(--rsm-th-control-border\)/,
		/select\.rsm-search-dispatcher \{[\s\S]*?border: 1px solid var\(--rsm-th-control-border\)/,
	];
	for (const rule of controlRules) assert.match(scss, rule);
});

test('no palette is secretly light', () => {
	// The module is a dark skin for old reddit and the repo ships no light variant.
	// A palette whose background is bright would invert every other assumption in
	// the stylesheet, and the contrast checks above would still pass.
	for (const id of PAGE_THEME_IDS) {
		const bg = luminance(hex(palette(id)['rsm-th-bg']));
		assert.ok(bg < 0.2, `${id} has a background luminance of ${bg.toFixed(3)} — that is not a dark theme`);
	}
});
