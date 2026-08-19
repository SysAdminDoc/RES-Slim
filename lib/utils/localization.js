/* @flow */

// Date, time and number formatting, on the platform's own `Intl` rather than a
// bundled library.
//
// This was `dayjs` plus ten bundled locale files and two plugins: about 38KB in
// each of the foreground and options bundles, carried for the five functions
// below. `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` and `Intl.NumberFormat`
// are all inside the browser floor (chrome 125 / firefox 130), cost nothing, and
// know every locale the browser knows rather than the ten that were compiled in.
// A user reading reddit in Japanese used to get English dates.
//
// `Intl.DurationFormat` is deliberately *not* used: it is Chrome 129 / Firefox
// 136, outside the floor. `formatDateDiff` builds its phrase from
// `Intl.NumberFormat`'s unit style instead, which is Baseline and gets plurals
// right in every locale — something the old `chrome.i18n` path could not express
// at all.

import { locale } from '../environment';

// `locale` is a mutable binding: it starts as `navigator.language` and is
// replaced once reddit's own language preference is known. Caching a formatter
// with `once()` would therefore pin whichever locale happened to be current at
// first use, which is what the dayjs version did. Keyed on the value instead, so
// a locale change rebuilds.
function perLocale<T>(build: (localeTag: string) => T): () => T {
	let builtFor;
	let cached;
	return () => {
		if (cached === undefined || builtFor !== locale) {
			builtFor = locale;
			cached = build(locale);
		}
		return cached;
	};
}

// `dateStyle: 'short'` and `timeStyle: 'medium'` are the equivalents of dayjs's
// `L` and `LTS` tokens: a numeric date, and a time carrying seconds.
const dateFormat = perLocale(tag => new Intl.DateTimeFormat(tag, { dateStyle: 'short' }));
const dateTimeFormat = perLocale(tag => new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'medium' }));
const numberFormat = perLocale(tag => new Intl.NumberFormat(tag));
// `numeric: 'auto'` is what turns "1 day ago" into "yesterday" where the locale
// has a word for it.
const relativeFormat = perLocale(tag => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }));

const durationFormats = perLocale(tag => {
	const cache: Map<TimeUnit, Intl$NumberFormat> = new Map();
	return (unit: TimeUnit) => {
		let format = cache.get(unit);
		if (!format) {
			format = new Intl.NumberFormat(tag, { style: 'unit', unit, unitDisplay: 'long' });
			cache.set(unit, format);
		}
		return format;
	};
});

// The literal union, not `string`: `Intl.RelativeTimeFormat.format` accepts only
// these, and typing it loosely would move the mistake to runtime.
export type TimeUnit = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

// Largest first. The month and year lengths are the average Gregorian ones, so
// "1 year" means an actual year rather than 365 days.
const UNITS: Array<[TimeUnit, number]> = [
	['year', 31556952000],
	['month', 2629746000],
	['day', 86400000],
	['hour', 3600000],
	['minute', 60000],
	['second', 1000],
];

// The coarsest unit that the difference fills at least once.
export function pickTimeUnit(deltaMs: number): {| value: number, unit: TimeUnit |} {
	for (const [i, [unit, ms]] of UNITS.entries()) {
		if (Math.abs(deltaMs) < ms && i < UNITS.length - 1) continue;

		const value = Math.round(deltaMs / ms);
		// Rounding can push a value up into the unit above: 59.8 minutes does not
		// fill an hour, but rounds to "60 minutes". Promote rather than say that.
		if (i > 0) {
			const [largerUnit, largerMs] = UNITS[i - 1];
			if (Math.abs(value) * ms >= largerMs) {
				return { value: Math.round(deltaMs / largerMs), unit: largerUnit };
			}
		}
		return { value, unit };
	}
	return { value: 0, unit: 'second' };
}

export function formatNumber(number: number): string {
	return numberFormat().format(number);
}

export function formatDate(date?: Date /* = now */): string {
	return dateFormat().format(date || new Date());
}

export function formatDateTime(date?: Date /* = now */): string {
	return dateTimeFormat().format(date || new Date());
}

// A bare duration, with no "ago" or "in": "3 hours", "2 days". Direction is not
// part of it, which is why this cannot be `Intl.RelativeTimeFormat`.
export function formatDateDiff(from: Date, to?: Date /* = now */): string {
	const end = to ? to.getTime() : Date.now();
	const { value, unit } = pickTimeUnit(end - from.getTime());
	return durationFormats()(unit).format(Math.abs(value));
}

// A relative time with its direction: "3 hours ago", "in 2 days", "yesterday".
export function formatRelativeTime(from: Date): string {
	const { value, unit } = pickTimeUnit(from.getTime() - Date.now());
	return relativeFormat().format(value, unit);
}

// For callers that cannot name the global `Date` because they shadow it — the
// `filteReddit` browse case is literally `class Date extends Case`. Returns a
// timestamp, or NaN for anything unparseable, which is the check `isValid` wants.
export function parseDateInput(value: string): number {
	return new Date(value).getTime();
}

export function nowMs(): number {
	return Date.now();
}
