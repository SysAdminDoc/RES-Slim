/* @flow */
// Pure helpers for the pageTheme module. Maps the module options to the set of
// <html> classes that gate the theme stylesheet. Dependency-free for unit testing.

export const PAGE_THEME_IDS: $ReadOnlyArray<string> = Object.freeze([
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

const DEFAULT_THEME = 'oled';

export function normalizeTheme(value: mixed): string {
	return typeof value === 'string' && PAGE_THEME_IDS.includes(value) ? value : DEFAULT_THEME;
}

type ThemeOptions = {|
	theme: mixed,
	declutter?: mixed,
	roundedCorners?: mixed,
	collapseSidebar?: mixed,
|};

// Build the ordered class list for <html>. Always includes the master class and
// exactly one palette class; the toggles append their own gate classes.
export function desiredThemeClasses(opts: ThemeOptions): string[] {
	const classes = ['res-pageTheme', `res-pageTheme--${normalizeTheme(opts.theme)}`];
	if (opts.declutter) classes.push('res-pageTheme--declutter');
	if (opts.roundedCorners) classes.push('res-pageTheme--rounded');
	if (opts.collapseSidebar) classes.push('res-pageTheme--collapse-sidebar');
	return classes;
}

// A CSS color the module is willing to apply as the accent. Accepts #rgb/#rrggbb
// (with optional alpha) so a malformed option value can't inject arbitrary text
// into an inline style declaration.
export function sanitizeAccent(value: mixed): string | null {
	if (typeof value !== 'string') return null;
	const v = value.trim();
	return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null;
}
