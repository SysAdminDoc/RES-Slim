import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const styles = fs.readFileSync(path.join(repoRoot, 'lib/options/options.scss'), 'utf8');

const THEMES = ['oled', 'paper', 'graphite', 'midnight', 'forest', 'ember', 'catppuccin', 'tokyonight', 'rosepine'];

function extractBlock(theme) {
	const re = theme === 'oled'
		? /:root\s*\{([\s\S]*?)\n\}/
		: new RegExp(`html\\[data-settings-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`);
	const match = styles.match(re);
	assert.ok(match, `theme block missing: ${theme}`);
	return match[1];
}

function readToken(block, name) {
	const re = new RegExp(`${name}:\\s*([^;]+);`);
	const match = block.match(re);
	assert.ok(match, `token ${name} missing from block`);
	return match[1].trim();
}

function parseColor(value) {
	const trimmed = value.trim();
	const hex = trimmed.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = parseInt(hex[1], 16);
		return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
	}
	const shortHex = trimmed.match(/^#([0-9a-f]{3})$/i);
	if (shortHex) {
		const [r, g, b] = shortHex[1].split('').map(c => parseInt(c + c, 16));
		return { r, g, b, a: 1 };
	}
	const rgb = trimmed.match(/^rgba?\(\s*([^)]+)\)$/i);
	if (rgb) {
		const parts = rgb[1].split(/[ ,/]+/).filter(Boolean);
		const [r, g, b, a = '1'] = parts;
		return {
			r: Number(r),
			g: Number(g),
			b: Number(b),
			a: a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a),
		};
	}
	const rgbFunc = trimmed.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*(\d+(?:\.\d+)?%?))?\s*\)$/);
	if (rgbFunc) {
		const [, r, g, b, a = '1'] = rgbFunc;
		return {
			r: Number(r),
			g: Number(g),
			b: Number(b),
			a: a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a),
		};
	}
	throw new Error(`Unsupported color value: ${value}`);
}

// Accent tints are declared once in :root as color-mix() over the theme's own
// --options-accent, so resolving one needs the accent from the theme block
// rather than a literal in it. Mixing a colour with `transparent` in sRGB is
// exactly "same colour at N% alpha", which is what the CSS engine does.
function resolveAccentMix(value, accent) {
	const mix = value.trim().match(/^color-mix\(in srgb,\s*var\(--options-accent\)\s*([\d.]+)%,\s*transparent\)$/);
	if (!mix) return null;
	return { ...accent, a: Number(mix[1]) / 100 };
}

function readAccentTint(name, themeBlock, rootBlock) {
	const accent = parseColor(readToken(themeBlock, '--options-accent'));
	const declared = readToken(rootBlock, name);
	const resolved = resolveAccentMix(declared, accent);
	assert.ok(resolved, `${name} is expected to be derived from --options-accent, got: ${declared}`);
	return resolved;
}

function flattenOver(top, base) {
	if (top.a >= 1) return top;
	const a = top.a;
	return {
		r: top.r * a + base.r * (1 - a),
		g: top.g * a + base.g * (1 - a),
		b: top.b * a + base.b * (1 - a),
		a: 1,
	};
}

function relLuminance({ r, g, b }) {
	const channel = c => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
	const l1 = relLuminance(fg);
	const l2 = relLuminance(bg);
	const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
	return (light + 0.05) / (dark + 0.05);
}

const TEXT_AA = 4.5;
const LARGE_AA = 3;
const UI_AA = 3;

for (const theme of THEMES) {
	test(`${theme}: body copy meets WCAG AA on every surface (text >= 4.5:1)`, () => {
		const block = extractBlock(theme);
		const bg = parseColor(readToken(block, '--options-bg'));
		const panel = parseColor(readToken(block, '--options-panel'));
		const panelRaised = parseColor(readToken(block, '--options-panel-raised'));
		const field = parseColor(readToken(block, '--options-field'));
		const text = parseColor(readToken(block, '--options-text'));

		for (const [label, surface] of [['bg', bg], ['panel', panel], ['panel-raised', panelRaised], ['field', field]]) {
			const ratio = contrast(text, surface);
			assert.ok(ratio >= TEXT_AA, `${theme}: --options-text on ${label} = ${ratio.toFixed(2)}:1 (needs >= ${TEXT_AA})`);
		}
	});

	test(`${theme}: muted text meets WCAG AA-large on the primary surfaces (>= 3:1)`, () => {
		const block = extractBlock(theme);
		const bg = parseColor(readToken(block, '--options-bg'));
		const panel = parseColor(readToken(block, '--options-panel'));
		const muted = parseColor(readToken(block, '--options-text-muted'));

		for (const [label, surface] of [['bg', bg], ['panel', panel]]) {
			const ratio = contrast(muted, surface);
			assert.ok(ratio >= LARGE_AA, `${theme}: --options-text-muted on ${label} = ${ratio.toFixed(2)}:1 (needs >= ${LARGE_AA})`);
		}
	});

	test(`${theme}: accent reaches WCAG AA UI contrast on primary surfaces (>= 3:1)`, () => {
		const block = extractBlock(theme);
		const bg = parseColor(readToken(block, '--options-bg'));
		const panel = parseColor(readToken(block, '--options-panel'));
		const accent = parseColor(readToken(block, '--options-accent'));

		for (const [label, surface] of [['bg', bg], ['panel', panel]]) {
			const ratio = contrast(accent, surface);
			assert.ok(ratio >= UI_AA, `${theme}: --options-accent on ${label} = ${ratio.toFixed(2)}:1 (needs >= ${UI_AA})`);
		}
	});
}

// Every surface `--options-text-soft` can actually land on. It is the
// placeholder colour, the disabled-control colour, and the hint colour under
// about thirty labels, so "the primary surfaces" is not the right scope for it —
// the failures were on the surfaces the existing suites never reached.
const SURFACE_TOKENS = [
	'--options-bg',
	'--options-panel',
	'--options-panel-alt',
	'--options-panel-raised',
	'--options-field',
	'--options-field-hover',
];

for (const theme of THEMES) {
	test(`${theme}: soft text meets WCAG AA on every surface it lands on (>= 4.5:1)`, () => {
		// Placeholders and hints are body-size text, so 4.5:1 — not the 3:1 the
		// muted suite above uses, and not only on bg and panel. Measured before the
		// fix: rosepine 2.94, tokyonight 3.56, catppuccin 3.77, and graphite,
		// midnight and ember all sitting a hundredth or two under the line.
		const block = extractBlock(theme);
		const soft = parseColor(readToken(block, '--options-text-soft'));

		for (const name of SURFACE_TOKENS) {
			const ratio = contrast(soft, parseColor(readToken(block, name)));
			assert.ok(ratio >= TEXT_AA, `${theme}: --options-text-soft on ${name} = ${ratio.toFixed(2)}:1 (needs >= ${TEXT_AA})`);
		}
	});

	test(`${theme}: control boundaries meet WCAG 1.4.11 (>= 3:1)`, () => {
		// 1.4.11 covers "visual information required to identify user interface
		// components". A text field's boundary is exactly that. `--options-border`
		// measured 1.09-1.50 here, so `--options-control-border` exists to carry
		// the controls while `--options-border` stays decorative.
		const block = extractBlock(theme);
		const border = parseColor(readToken(block, '--options-control-border'));

		for (const name of SURFACE_TOKENS) {
			const surface = parseColor(readToken(block, name));
			const ratio = contrast(flattenOver(border, surface), surface);
			assert.ok(ratio >= UI_AA, `${theme}: --options-control-border on ${name} = ${ratio.toFixed(2)}:1 (needs >= ${UI_AA})`);
		}
	});
}

test('no disabled state is expressed as an opacity multiplier', () => {
	// This is the assertion that would have caught the original defect. Three
	// rules faded a control with `opacity`, which composites the text *and* the
	// boundary toward the background: `--options-text-soft` at .72 measured
	// 2.37-3.40:1, under AA in all nine themes and under 3:1 in four. A disabled
	// control still has to be readable — WCAG's incidental-content exemption is
	// about not blocking a design, not a licence to make state unreadable.
	const offenders = [];
	const lines = styles.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		// Comments are excluded, or this fails on its own explanation — the same
		// trap `codeOnly()` exists for elsewhere in the suite.
		if (/^\s*\/\//.test(lines[i])) continue;
		if (!/opacity:\s*\.?\d/.test(lines[i])) continue;
		// Look back for the selector this declaration belongs to.
		const context = lines.slice(Math.max(0, i - 12), i + 1).join('\n');
		if (!/:disabled|\[disabled\]|\.is-disabled|aria-disabled/.test(context)) continue;
		// A transition *listing* opacity is not a disabled treatment.
		if (/transition/.test(lines[i])) continue;
		offenders.push(`${i + 1}: ${lines[i].trim()}`);
	}

	assert.deepEqual(offenders, [], 'express disabled with an explicit colour and surface, not by fading the control');
});

test('the contrast helper parses the rgba() borders the palettes actually use', () => {
	// Guard for the suites above. `page-theme-contrast-contract`'s own helper
	// asserts a hex match and throws on anything else, which is why eight of ten
	// page palettes had their borders silently uncovered — a parser that cannot
	// read the value cannot fail on it either.
	assert.deepEqual(parseColor('#abcdef'), { r: 0xab, g: 0xcd, b: 0xef, a: 1 });
	assert.deepEqual(parseColor('#abc'), { r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
	assert.deepEqual(parseColor('rgba(255, 255, 255, 0.09)'), { r: 255, g: 255, b: 255, a: 0.09 });
	assert.deepEqual(parseColor('rgb(0 0 0 / 28%)'), { r: 0, g: 0, b: 0, a: 0.28 });
	assert.throws(() => parseColor('color-mix(in srgb, red 50%, blue)'), /Unsupported color value/);
});

test('accent tints remain legible when flattened over the theme background', () => {
	const root = extractBlock('oled');
	for (const theme of THEMES) {
		const block = extractBlock(theme);
		const bg = parseColor(readToken(block, '--options-bg'));
		const text = parseColor(readToken(block, '--options-text'));
		// Every accent-derived fill a label can sit on, checked per theme. The
		// tints are declared once and derived, so this now covers all three
		// rather than only the one that used to be spelled out per theme.
		for (const name of ['--options-accent-soft', '--options-accent-tint', '--options-accent-ghost']) {
			const flattened = flattenOver(readAccentTint(name, block, root), bg);
			const ratio = contrast(text, flattened);
			assert.ok(ratio >= TEXT_AA, `${theme}: --options-text on flattened ${name} = ${ratio.toFixed(2)}:1`);
		}
	}
});

test('the focus ring is accent-derived in every theme, never a fixed hue', () => {
	const root = extractBlock('oled');
	const ring = readToken(root, '--options-focus-ring');
	assert.match(ring, /color-mix\(in srgb, var\(--options-accent\)/,
		'focus ring must follow the theme accent — it was previously hardcoded blue in every theme');
	// A theme that redefines the accent must not also redeclare the tints, or
	// the derivation silently stops applying to it.
	for (const theme of THEMES.filter(t => t !== 'oled')) {
		const block = extractBlock(theme);
		for (const name of ['--options-accent-soft', '--options-accent-tint', '--options-focus-ring', '--options-selection']) {
			assert.ok(!block.includes(`${name}:`), `${theme} must inherit ${name} from :root instead of redeclaring it`);
		}
	}
});
