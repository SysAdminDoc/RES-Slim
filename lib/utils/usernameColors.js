/* @flow */

// Deterministic per-username colouring.
//
// The idea comes from "Colorfull reddit usernames (CRU)" (Greasy Fork 5722) and
// the several forks of it. Those scripts pick a colour with `Math.random()`
// seeded off the character codes and write it straight into `style.color`, so
// the same author gets a different colour on every page load and a fair number
// of them land on near-black against old.reddit's white background — or
// near-white against pageTheme's dark one.
//
// This implementation fixes both problems: the hash is stable (FNV-1a over the
// lowercased name, so a rename of case does not change the colour), and only the
// hue is derived from it. Saturation and lightness are fixed per theme so every
// generated colour clears the same contrast floor, which is what the contract
// test measures.

export type UsernameColorOptions = {|
	// Lightness band. Dark backgrounds need light text and vice versa.
	dark?: boolean,
	saturation?: number,
	lightness?: number,
|};

// Names that must never be recoloured: they are not people, and two of them are
// already load-bearing colours in old.reddit's own stylesheet.
export const RESERVED_NAMES: string[] = ['[deleted]', '[removed]', 'automoderator'];

// Light text on a dark page, dark text on a light page. Both lightness values
// were found by walking every hue against the respective background and taking
// the band whose *worst* hue still clears WCAG AA (4.5:1) — not the average.
// Yellow is the binding constraint on white and blue is on black.
export const DARK_THEME_LIGHTNESS = 72;
export const LIGHT_THEME_LIGHTNESS = 29;
export const DEFAULT_SATURATION = 62;

// Saturation is user-editable, and on the light band raising it past this point
// pushes yellow below 4.5:1 (at S=100 it reaches only 3.2:1). The dark band
// survives the full 0–100 range, so only the light one is clamped. A contract
// test walks every hue at every saturation in both bands.
export const MAX_LIGHT_SATURATION = 62;

// FNV-1a, 32-bit. Chosen over summing char codes because the sum collides
// heavily on anagrams and on the short usernames reddit is full of.
export function hashUsername(name: string): number {
	const key = String(name || '').toLowerCase();
	let hash = 0x811c9dc5;
	for (const character of key) {
		hash ^= character.charCodeAt(0);
		// 32-bit FNV prime multiply, kept in range with Math.imul.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

export function isReservedName(name: ?string): boolean {
	if (!name) return true;
	return RESERVED_NAMES.includes(String(name).toLowerCase());
}

export function hueForUsername(name: string): number {
	return hashUsername(name) % 360;
}

export function colorForUsername(name: string, options: UsernameColorOptions = {}): string {
	const dark = options.dark !== false;
	const requested = typeof options.saturation === 'number' ? options.saturation : DEFAULT_SATURATION;
	const saturation = Math.round(dark ? requested : Math.min(requested, MAX_LIGHT_SATURATION));
	const defaultLightness = dark ? DARK_THEME_LIGHTNESS : LIGHT_THEME_LIGHTNESS;
	const lightness = typeof options.lightness === 'number' ? options.lightness : defaultLightness;

	return `hsl(${hueForUsername(name)}, ${saturation}%, ${lightness}%)`;
}

// --- contrast maths, used by the contract test and nothing else at runtime ---

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const sat = s / 100;
	const lig = l / 100;
	const c = (1 - Math.abs(2 * lig - 1)) * sat;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let rgb = [0, 0, 0];
	if (hp < 1) rgb = [c, x, 0];
	else if (hp < 2) rgb = [x, c, 0];
	else if (hp < 3) rgb = [0, c, x];
	else if (hp < 4) rgb = [0, x, c];
	else if (hp < 5) rgb = [x, 0, c];
	else rgb = [c, 0, x];
	const m = lig - c / 2;
	return [
		Math.round((rgb[0] + m) * 255),
		Math.round((rgb[1] + m) * 255),
		Math.round((rgb[2] + m) * 255),
	];
}

export function relativeLuminance([r, g, b]: [number, number, number]): number {
	const channel = (v: number) => {
		const srgb = v / 255;
		return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}
