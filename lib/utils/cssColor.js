/* @flow */

// Parsing just enough CSS colour to compare two stored values.
//
// This replaced `tinycolor2`, which was 28.6KB in each of the three bundles —
// 86KB shipped — for a surface that had shrunk to one comparison. `colorToArray`
// and `colorFromArray` in `lib/utils/color.js` had no callers at all. Their
// vectors did run, despite being written for `ava`, which is not installed:
// `tests/unit/utils-specs.test.mjs` shims `ava` and executes every spec under
// `lib/utils/__tests__/` with the real runner. They live in
// `tests/unit/css-color-contract.test.mjs` now.
//
// Hex and the rgb() family only. Named colours are deliberately not supported,
// and the reasoning is specific rather than lazy: the sole caller compares two
// stored option values after an identical-string fast path, so the parser is only
// ever asked whether two *different spellings* denote the same colour. `#DDD`
// against `#dddddd` is the realistic case and is handled; `red` against
// `#ff0000` would not be, and would leave a defunct module's colours alone. That
// is the same thing that happens when parsing fails, which is the safe direction.

export type Rgb = {| r: number, g: number, b: number, a: number |};

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB = /^rgba?\(\s*([^)]+)\)$/i;

function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function fromHex(digits: string): Rgb | null {
	const expand = (pair: string) => parseInt(pair.length === 1 ? pair + pair : pair, 16);
	// 3 and 4 digit forms are shorthand; 6 and 8 are full. 5 and 7 are not colours.
	if (digits.length === 3 || digits.length === 4) {
		return {
			r: expand(digits[0]),
			g: expand(digits[1]),
			b: expand(digits[2]),
			a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
		};
	}
	if (digits.length === 6 || digits.length === 8) {
		return {
			r: expand(digits.slice(0, 2)),
			g: expand(digits.slice(2, 4)),
			b: expand(digits.slice(4, 6)),
			a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
		};
	}
	return null;
}

function channel(raw: string): number | null {
	const text = raw.trim();
	if (!text) return null;
	// A percentage channel is relative to 255, not to 100.
	if (text.endsWith('%')) {
		const percent = Number(text.slice(0, -1));
		return Number.isFinite(percent) ? clampByte((percent / 100) * 255) : null;
	}
	const value = Number(text);
	return Number.isFinite(value) ? clampByte(value) : null;
}

function alpha(raw: string): number | null {
	const text = raw.trim();
	if (text.endsWith('%')) {
		const percent = Number(text.slice(0, -1));
		return Number.isFinite(percent) ? Math.max(0, Math.min(1, percent / 100)) : null;
	}
	const value = Number(text);
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

export function parseColor(input: mixed): Rgb | null {
	if (typeof input !== 'string') return null;
	const text = input.trim();
	if (!text) return null;

	const hex = HEX.exec(text);
	if (hex) return fromHex(hex[1]);

	const rgb = RGB.exec(text);
	if (rgb) {
		// Both spellings: `rgb(1, 2, 3)` and `rgb(1 2 3 / 50%)`.
		const [channels, alphaPart] = rgb[1].split('/');
		const parts = channels.split(/[\s,]+/).map(part => part.trim()).filter(Boolean);
		const explicitAlpha = alphaPart !== undefined ? alphaPart : (parts.length === 4 ? parts[3] : undefined);
		if (parts.length < 3) return null;

		const r = channel(parts[0]);
		const g = channel(parts[1]);
		const b = channel(parts[2]);
		if (r === null || g === null || b === null) return null;

		const parsedAlpha = explicitAlpha === undefined ? 1 : alpha(explicitAlpha);
		if (parsedAlpha === null) return null;
		return { r, g, b, a: parsedAlpha };
	}

	return null;
}

// True only when both parse and denote the same colour. An unparseable value
// answers false, which for the one caller means "leave the stored options alone".
export function sameColor(first: mixed, second: mixed): boolean {
	const a = parseColor(first);
	const b = parseColor(second);
	if (!a || !b) return false;
	return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
