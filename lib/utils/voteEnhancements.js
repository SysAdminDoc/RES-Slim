/* @flow */

import { parseColor } from './cssColor';
import { contrastRatio, hslToRgb } from './usernameColors';

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

export function scoreColorRgb(color: mixed): ?[number, number, number] {
	if (typeof color !== 'string' || !color.trim()) return null;
	return asRgb(color) || hslRgb(color);
}

export const SCORE_INK_ON_LIGHT = '#000';
export const SCORE_INK_ON_DARK = '#fff';

/**
 * The ink to write on a score colour that is being used as a ground.
 *
 * The rank badge paints the score colour behind the number, and the stylesheet
 * wrote `#fff` on top of it whatever it turned out to be. The automatic mode
 * walks the whole hue wheel at `hsl(H, 75%, 50%)`, so around a score of 150 the
 * badge is yellow and white on it measures 1.48:1.
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

export function automaticLinkScoreColor(score: number): string {
	return `hsl(${180 + 360 * (1 - 100 / (150 + score))}, 75%, 50%)`;
}

export function automaticCommentScoreColor(score: number): string {
	return `hsl(${180 + 360 * (1 - 50 / (100 + score))}, 75%, 50%)`;
}
