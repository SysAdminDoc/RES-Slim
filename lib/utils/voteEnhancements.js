/* @flow */

import { parseColor } from './cssColor';

export type ScoreThreshold = [number | string, string];

function asRgb(color: string): ?[number, number, number] {
	const parsed = parseColor(color);
	return parsed ? [parsed.r, parsed.g, parsed.b] : null;
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
