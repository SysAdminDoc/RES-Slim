/* @flow */
// Pure helpers for the pageTheme module. Maps the module options to the set of
// <html> classes that gate the theme stylesheet, and decides whether the user's
// accent colour is actually readable on the palette they picked.

import { contrastRatio, hslToRgb } from './usernameColors';

export const PAGE_THEME_IDS: $ReadOnlyArray<string> = Object.freeze([
	'classic',
	'oled',
	'graphite',
	'midnight',
	'catppuccin',
	'tokyonight',
	'rosepine',
	'nord',
	'dracula',
	'gruvbox',
	'solarized',
]);

const DEFAULT_THEME = 'classic';

export function normalizeTheme(value: mixed): string {
	return typeof value === 'string' && PAGE_THEME_IDS.includes(value) ? value : DEFAULT_THEME;
}

type ThemeOptions = {|
	theme: mixed,
	declutter?: mixed,
	roundedCorners?: mixed,
	collapseSidebar?: mixed,
	refinedLayout?: mixed,
	forcedColors?: mixed,
|};

// Build the ordered class list for <html>. Always includes the master class and
// exactly one palette class; the toggles append their own gate classes.
//
// `res-pageTheme--refined` is the gate on the whole classic layout, document
// sheet and shadow sheet alike, and it stands down under `forced-colors: active`.
// That is a decision rather than an omission, and this is where it is written
// down. Windows High Contrast discards author colours, `box-shadow` and every
// non-URL `background-image`, which is precisely what the layer is built out of:
// the vote arrows are a `::before` whose whole visual is a background colour cut
// with a `clip-path`, the thumbnail placeholders are background images, and the
// row and panel edges are shadows. Restating 3,787 lines of recreated chrome in
// system colours would be a large bet on a mode nobody has asked for; letting
// reddit's own accessible markup through is the honest fallback, and reddit
// draws its controls with `currentColor` SVGs that survive the mode intact.
//
// The palette classes stay. They only set colours, and the UA is already
// overriding every one of them, so removing them would change nothing except
// what a reader sees if they turn the mode off again.
export function desiredThemeClasses(opts: ThemeOptions): string[] {
	const classes = ['res-pageTheme', `res-pageTheme--${normalizeTheme(opts.theme)}`];
	if (opts.declutter) classes.push('res-pageTheme--declutter');
	if (opts.roundedCorners) classes.push('res-pageTheme--rounded');
	if (opts.refinedLayout && !opts.forcedColors) classes.push('res-pageTheme--refined');
	if (opts.collapseSidebar) classes.push('res-pageTheme--collapse-sidebar');
	return classes;
}

// Split out so the module can read it and a contract can drive both answers
// without a browser. `matchMedia` is absent in some contexts this runs in.
export function forcedColorsActive(): boolean {
	if (typeof matchMedia !== 'function') return false;
	try {
		return matchMedia('(forced-colors: active)').matches;
	} catch (e) {
		return false;
	}
}

// A CSS color the module is willing to apply as the accent. Accepts #rgb/#rrggbb
// (with optional alpha) so a malformed option value can't inject arbitrary text
// into an inline style declaration.
export function sanitizeAccent(value: mixed): string | null {
	if (typeof value !== 'string') return null;
	const v = value.trim();
	return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null;
}

// --- accent readability ----------------------------------------------------
//
// `accent` is a `type: 'color'` option, so the only thing stopping a user from
// choosing `#333` is that nothing does. Syntax is all `sanitizeAccent` can
// judge, and the same hex is fine on one palette and invisible on another —
// readability is a property of the pair, not of the colour. The accent paints
// visited post titles (body text, so 4.5:1) and the `:focus-visible` outline
// (non-text, so 3:1), and an invisible focus ring is a keyboard-accessibility
// failure the user can inflict on themselves with no feedback at all.
//
// Mirrors `--rsm-th-bg` / `-bg-elev` / `-bg-raise` per palette in
// lib/css/modules/_pageTheme.scss. `page-theme-accent-contract` re-parses that
// file and fails when the two drift, because a palette edit that did not reach
// here would silently move the floor.
export const PALETTE_SURFACES: { +[string]: $ReadOnlyArray<string> } = Object.freeze({
	classic: Object.freeze(['#fff', '#fff', '#f5f5f5']),
	oled: Object.freeze(['#000', '#121212', '#1b1b1b']),
	graphite: Object.freeze(['#0b0f14', '#111821', '#18212c']),
	midnight: Object.freeze(['#08131f', '#0f1e2e', '#16293c']),
	catppuccin: Object.freeze(['#1e1e2e', '#282a3a', '#313244']),
	tokyonight: Object.freeze(['#1a1b26', '#24283b', '#2f3549']),
	rosepine: Object.freeze(['#191724', '#1f1d2e', '#26233a']),
	nord: Object.freeze(['#2e3440', '#3b4252', '#3f4859']),
	dracula: Object.freeze(['#282a36', '#343746', '#383b4b']),
	gruvbox: Object.freeze(['#282828', '#32302f', '#3c3836']),
	solarized: Object.freeze(['#002b36', '#073642', '#0d4552']),
});

// WCAG 1.4.3 for the visited-title text, 1.4.11 for the focus outline.
export const TEXT_CONTRAST_TARGET = 4.5;
export const NON_TEXT_CONTRAST_TARGET = 3;

// The token every palette defines as its highest-contrast foreground. Used when
// even a fully lightened accent cannot clear the floor, so "guaranteed" means
// guaranteed rather than best-effort.
export const GUARANTEED_CONTRAST_TOKEN = 'var(--rsm-th-txt-strong)';

export function hexToRgb(value: mixed): [number, number, number] | null {
	const hex = sanitizeAccent(value);
	if (!hex) return null;
	let body = hex.slice(1);
	// Alpha is dropped rather than composited: the accent is painted on an opaque
	// palette surface, and treating a translucent accent as opaque overstates its
	// contrast — so drop the channel and measure the colour the user chose.
	if (body.length === 4 || body.length === 8) body = body.slice(0, body.length === 4 ? 3 : 6);
	if (body.length === 3) body = body.split('').map(c => c + c).join('');
	return [
		parseInt(body.slice(0, 2), 16),
		parseInt(body.slice(2, 4), 16),
		parseInt(body.slice(4, 6), 16),
	];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
	const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
	return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l * 100];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h;
	if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
	else if (max === gn) h = (bn - rn) / d + 2;
	else h = (rn - gn) / d + 4;
	return [h * 60, s * 100, l * 100];
}

// The worst contrast the accent achieves against any surface the palette paints
// behind it. Worst case, not average: a colour that is readable on the page
// background and invisible on a raised card is not readable.
export function accentContrast(accent: mixed, theme: mixed): number {
	const rgb = hexToRgb(accent);
	if (!rgb) return 0;
	const surfaces = PALETTE_SURFACES[normalizeTheme(theme)];
	return surfaces.reduce((worst, surface) => {
		const surfaceRgb = hexToRgb(surface);
		if (!surfaceRgb) return worst;
		return Math.min(worst, contrastRatio(rgb, surfaceRgb));
	}, Infinity);
}

// Keep the user's hue and move only lightness, in whichever direction clears
// the target with the smallest change. Most palettes need a lighter accent;
// Classic Reddit's white surfaces need a darker one.
export function nearestReadableAccent(accent: mixed, theme: mixed, target: number = TEXT_CONTRAST_TARGET): string | null {
	const rgb = hexToRgb(accent);
	if (!rgb) return null;
	if (accentContrast(accent, theme) >= target) return rgbToHex(rgb);

	const [h, s, originalLightness] = rgbToHsl(rgb);
	// Whole-percent steps ordered by distance from the chosen lightness. This is
	// intentionally symmetric: a light palette must not receive the old
	// dark-palette-only "keep lightening" treatment.
	const lightnesses = Array.from({ length: 101 }, (_, l) => l)
		.sort((a, b) => Math.abs(a - originalLightness) - Math.abs(b - originalLightness));
	const found = lightnesses
		.map(l => rgbToHex(hslToRgb(h, s, l)))
		.find(candidate => accentContrast(candidate, theme) >= target);
	return found || null;
}

// What the module should actually paint, split by role. The raw accent is kept
// for the decorative `color-mix()` uses — those blend it into a background at
// 14-50% and forcing them to a corrected shade would change the look of a
// perfectly legible theme — while text and focus get shades that clear their
// floor.
export function accentRoles(accent: mixed, theme: mixed): {|
	accent: string | null,
	text: string | null,
	focus: string | null,
	ratio: number,
	textAdjusted: boolean,
	focusAdjusted: boolean,
|} {
	const raw = sanitizeAccent(accent);
	if (!raw || !hexToRgb(raw)) {
		return { accent: null, text: null, focus: null, ratio: 0, textAdjusted: false, focusAdjusted: false };
	}

	const ratio = accentContrast(raw, theme);
	const text = ratio >= TEXT_CONTRAST_TARGET ? raw : nearestReadableAccent(raw, theme, TEXT_CONTRAST_TARGET);
	const focus = ratio >= NON_TEXT_CONTRAST_TARGET ? raw : nearestReadableAccent(raw, theme, NON_TEXT_CONTRAST_TARGET);

	return {
		accent: raw,
		text: text || GUARANTEED_CONTRAST_TOKEN,
		focus: focus || GUARANTEED_CONTRAST_TOKEN,
		ratio,
		textAdjusted: text !== raw,
		focusAdjusted: focus !== raw,
	};
}
