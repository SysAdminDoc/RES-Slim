import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const styles = fs.readFileSync(path.join(repoRoot, 'lib/options/options.scss'), 'utf8');

const THEMES = ['oled', 'graphite', 'midnight', 'forest', 'ember', 'catppuccin', 'tokyonight', 'rosepine'];

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

test('accent-soft overlay remains legible when flattened over the theme background', () => {
	for (const theme of THEMES) {
		const block = extractBlock(theme);
		const bg = parseColor(readToken(block, '--options-bg'));
		const accentSoft = parseColor(readToken(block, '--options-accent-soft'));
		const flattened = flattenOver(accentSoft, bg);
		const text = parseColor(readToken(block, '--options-text'));
		const ratio = contrast(text, flattened);
		assert.ok(ratio >= TEXT_AA, `${theme}: --options-text on flattened accent-soft = ${ratio.toFixed(2)}:1`);
	}
});
