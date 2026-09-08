/* @flow */

import { parseColor } from './cssColor';
import { contrastRatio, hslToRgb, rgbToHsl } from './usernameColors';

export type ScoreThreshold = [number | string, string];

function asRgb(color: string): ?[number, number, number] {
	const parsed = parseColor(color);
	return parsed ? [parsed.r, parsed.g, parsed.b] : null;
}

// `parseColor` reads hex and the rgb() family, which is everything a *stored*
// option can hold. The automatic modes below are the other producer, and they
// emit `hsl()`, so resolving one needs this second arm.
const HSL = /^hsla?\(\s*([^)]+)\)$/i;

function hslRgb(color: string): ?[number, number, number] {
	const match = HSL.exec(color.trim());
	if (!match) return null;
	// Both the legacy comma form and the modern space form, with the alpha
	// separator tolerated because it is dropped either way.
	const parts = match[1].split(/[\s,/]+/).filter(Boolean);
	if (parts.length < 3) return null;
	const h = Number(parts[0].replace(/deg$/i, ''));
	const s = Number(parts[1].replace(/%$/, ''));
	const l = Number(parts[2].replace(/%$/, ''));
	if (![h, s, l].every(v => Number.isFinite(v))) return null;
	return hslToRgb(h, s, l);
}

// Alpha is dropped rather than composited, the same way `hexToRgb` in
// `lib/utils/pageTheme.js` drops it: what is behind a translucent ground is the
// listing row, which this has no handle on. A stored threshold colour can only
// pick up an alpha channel through an imported settings backup, since the
// console's cell is an `input[type=color]`.
export function scoreColorRgb(color: mixed): ?[number, number, number] {
	if (typeof color !== 'string' || !color.trim()) return null;
	return asRgb(color) || hslRgb(color);
}

// A surface a score can be judged against, or null if it is not one.
//
// The alpha comes from the parser, not from the serialised text. A regex on the
// text cannot do this: `getComputedStyle` serialises an opaque colour as
// `rgb(r, g, b)`, so `rgba(0, 0, 0, 0)` and a genuinely black `rgb(0, 0, 0)`
// both end in `0)` -- and reading a black page as transparent, and therefore as
// white, darkens the score until it is invisible on it.
//
// A translucent surface is refused rather than composited: what shows through it
// is the real ground, and this has no handle on that.
export function opaqueGround(color: mixed): ?[number, number, number] {
	if (typeof color !== 'string' || !color.trim()) return null;
	const parsed = parseColor(color.trim());
	if (!parsed || parsed.a < 0.95) return null;
	return [parsed.r, parsed.g, parsed.b];
}

export const TEXT_CONTRAST_TARGET = 4.5;

// Whole-percent lightnesses, ordered by distance from a starting point. Nearest
// first, so the smallest change that clears the floor is the one taken.
function lightnessesAround(start: number): number[] {
	return Array.from({ length: 101 }, (_, l) => l).sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
}

/**
 * The score colour, moved only in lightness until it is readable on every
 * surface it can land on.
 *
 * The rank badge paints the score colour behind the number and can pick a black
 * or white ink for it. The score *text* has no ground of its own: it is painted
 * straight onto whatever the listing behind it is, so the same colour that is
 * fine in a badge measures 1.43:1 as text on old Reddit's white row at 150
 * points, and the `user` mode's no-rows default is 1.71:1.
 *
 * Black or white is not an option here, because the hue *is* the feature -- the
 * whole point is that the number's colour tells you roughly what the score is.
 * So the hue and the saturation are kept and only the L channel moves, the same
 * way `nearestReadableAccent` in `lib/utils/pageTheme.js` corrects a custom
 * accent.
 *
 * Every ground, not one. A score element does not sit on a single surface: the
 * palette paints `.thing` with `--rsm-th-bg-elev`, a hovered listing row with
 * `--rsm-th-bg-raise`, and alternating comment depths with both -- so a colour
 * corrected against the page background alone goes back under the floor the
 * moment the reader hovers a row. This is the same worst-case rule
 * `accentContrast` already applies to a custom accent, and for the same reason:
 * a colour that is readable on the page and invisible on a raised card is not
 * readable.
 *
 * A colour that already clears the floor everywhere is returned untouched. So is
 * one for which no lightness clears every ground at once, which is reachable
 * when a page mixes a light surface with a dark one: refusing to colour at all,
 * or picking black and losing the hue, would both be bigger changes than the
 * reader asked for.
 */
export function readableScoreText(color: string, grounds: $ReadOnlyArray<[number, number, number]>): string {
	const rgb = scoreColorRgb(color);
	if (!rgb || !grounds.length) return color;

	const readable = candidate => grounds.every(ground => contrastRatio(candidate, ground) >= TEXT_CONTRAST_TARGET);
	if (readable(rgb)) return color;

	const [h, s, lightness] = rgbToHsl(rgb);
	const found = lightnessesAround(lightness).map(l => hslToRgb(h, s, l)).find(readable);
	return found ? `rgb(${found[0]}, ${found[1]}, ${found[2]})` : color;
}

export const SCORE_INK_ON_LIGHT = '#000';
export const SCORE_INK_ON_DARK = '#fff';

/**
 * The ink to write on a score colour that is being used as a ground.
 *
 * The rank badge paints the score colour behind the number, and the stylesheet
 * wrote `#fff` on top of it whatever it turned out to be. The automatic mode
 * walks the whole hue wheel at `hsl(H, 75%, 50%)`, so around a score of 150 the
 * badge is yellow and white on it measures 1.43:1.
 *
 * Black or white, whichever is further from the ground. That choice can never
 * fall below 4.58:1: the two ratios cross at a relative luminance of 0.179,
 * where each is (0.179 + 0.05) / 0.05, so the better of the pair clears 4.5:1
 * for every colour that exists. An unparseable ground keeps the old white,
 * which is what the badge has always had.
 */
export function readableScoreInk(color: mixed): string {
	const rgb = scoreColorRgb(color);
	if (!rgb) return SCORE_INK_ON_DARK;
	const onLight = contrastRatio(rgb, [0, 0, 0]);
	const onDark = contrastRatio(rgb, [255, 255, 255]);
	return onLight >= onDark ? SCORE_INK_ON_LIGHT : SCORE_INK_ON_DARK;
}

function rgb([r, g, b]: [number, number, number]): string {
	return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Resolve a score against ascending [threshold, colour] rows.
 *
 * This is upstream RES's threshold algorithm with the removed lodash helper
 * replaced by a three-channel map. Invalid saved rows are ignored instead of
 * turning a score into an invalid inline style.
 */
export function thresholdScoreColor(
	score: number,
	rows: ScoreThreshold[],
	defaultColor: string,
	interpolate: boolean,
): string {
	const colors = rows
		.map(([bound, color]) => [Number(bound), color])
		.filter(([bound, color]) => Number.isFinite(bound) && asRgb(String(color)))
		.sort(([a], [b]) => Number(a) - Number(b));

	if (!colors.length) return defaultColor;
	if (score < Number(colors[0][0])) return String(colors[0][1]);
	if (score >= Number(colors[colors.length - 1][0])) return String(colors[colors.length - 1][1]);

	for (let index = 0; index < colors.length - 1; index += 1) { // eslint-disable-line no-restricted-syntax
		const [lowBound, lowColor] = colors[index];
		const [highBound, highColor] = colors[index + 1];
		if (score < Number(lowBound) || score >= Number(highBound)) continue;

		if (!interpolate) {
			// For negative scores, the threshold closest to zero owns the interval.
			return String(score < 0 ? highColor : lowColor);
		}

		const low = asRgb(String(lowColor));
		const high = asRgb(String(highColor));
		if (!low || !high) return defaultColor;
		const fraction = (score - Number(lowBound)) / (Number(highBound) - Number(lowBound));
		const channels: [number, number, number] = (low.map((channel, channelIndex) => (
			Math.round(channel + (high[channelIndex] - channel) * fraction)
		)): any);
		return rgb(channels);
	}

	return defaultColor;
}

// Both of these divide by an offset score, and both offsets can be exactly zero:
// a post at -150 and a comment at -100. `hsl(-Infinity, 75%, 50%)` is not a
// colour, so `setProperty` rejects it and the rank badge is left with no ground
// painted at all. Clamping the divisor to a magnitude of one leaves every other
// integer score untouched -- for integers the magnitude is only ever below one
// when it is zero -- and makes the singular score render as its neighbour does.
function offset(value: number): number {
	return Math.abs(value) < 1 ? (Math.sign(value) || 1) : value;
}

export function automaticLinkScoreColor(score: number): string {
	return `hsl(${180 + 360 * (1 - 100 / offset(150 + score))}, 75%, 50%)`;
}

export function automaticCommentScoreColor(score: number): string {
	return `hsl(${180 + 360 * (1 - 50 / offset(100 + score))}, 75%, 50%)`;
}
