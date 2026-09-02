/* @flow */

// The settings console has nine painted presets and one choice that is not a
// preset at all: `system`, which follows the operating system's colour scheme.
//
// Two vocabularies, deliberately kept apart. A *choice* is what the reader
// picked and what is persisted — one of the nine ids, or `system`. A *preset* is
// what actually gets painted, and is always one of the nine, because every theme
// block in `options.scss` is keyed on `html[data-settings-theme='<preset>']`.
// `resolveSettingsTheme` is the only bridge between them. Mixing the two is how
// you end up writing `system` into that attribute and silently falling back to
// the `:root` defaults, which is neither of the two themes the reader asked for.

export const SETTINGS_THEME_SYSTEM = 'system';

// What a fresh install gets. It was `oled` for the console's whole life, which
// meant a reader on a light desktop opened a black settings page and had to go
// find the picker.
export const DEFAULT_SETTINGS_THEME = SETTINGS_THEME_SYSTEM;

// The two presets `system` resolves to. `paper` is the only preset that declares
// `color-scheme: light`, and `oled` is what the console defaulted to before this
// existed, so following the system changes nothing for a reader on a dark
// desktop who never touched the picker.
export const SYSTEM_THEME_LIGHT = 'paper';
export const SYSTEM_THEME_DARK = 'oled';

// Where the settings console persists the chosen theme. The permissions prompt
// is served from the same extension origin, so it can read this directly and
// paint itself with the same accent instead of always using graphite's blue.
export const SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme';

// `accent` mirrors --options-accent in options.scss. Both surfaces read it from
// here so a theme's accent is defined once; options.scss derives every tint from
// its own copy via color-mix, and the prompt page sets this one inline.
export const SETTINGS_THEME_PRESETS = Object.freeze([
	{ id: 'oled', labelKey: 'settingsConsoleThemeOled', metaColor: '#050608', accent: '#ff7a18' },
	{ id: 'paper', labelKey: 'settingsConsoleThemePaper', metaColor: '#f8f7f3', accent: '#c2410c' },
	{ id: 'graphite', labelKey: 'settingsConsoleThemeGraphite', metaColor: '#0d1117', accent: '#58a6ff' },
	{ id: 'midnight', labelKey: 'settingsConsoleThemeMidnight', metaColor: '#08131f', accent: '#58c3ff' },
	{ id: 'forest', labelKey: 'settingsConsoleThemeForest', metaColor: '#0d1712', accent: '#4ed59a' },
	{ id: 'ember', labelKey: 'settingsConsoleThemeEmber', metaColor: '#1a1210', accent: '#ff9b57' },
	{ id: 'catppuccin', labelKey: 'settingsConsoleThemeCatppuccin', metaColor: '#1e1e2e', accent: '#cba6f7' },
	{ id: 'tokyonight', labelKey: 'settingsConsoleThemeTokyoNight', metaColor: '#1a1b26', accent: '#7aa2f7' },
	{ id: 'rosepine', labelKey: 'settingsConsoleThemeRosePine', metaColor: '#191724', accent: '#c4a7e7' },
]);

// What the picker renders. `system` leads, because it is the default and because
// a reader looking for "just match my desktop" should not have to read nine
// names first.
export const SETTINGS_THEME_CHOICES = Object.freeze([
	{ id: SETTINGS_THEME_SYSTEM, labelKey: 'settingsConsoleThemeSystem' },
	...SETTINGS_THEME_PRESETS,
]);

const settingsThemeIds = new Set(SETTINGS_THEME_PRESETS.map(({ id }) => id));

// A stored choice, which may be `system`. Anything unrecognised — a value from a
// future version, a key someone edited by hand — becomes the default.
export function normalizeSettingsTheme(theme: mixed): string {
	if (theme === SETTINGS_THEME_SYSTEM) return SETTINGS_THEME_SYSTEM;
	return typeof theme === 'string' && settingsThemeIds.has(theme) ? theme : DEFAULT_SETTINGS_THEME;
}

export function isSystemSettingsTheme(theme: mixed): boolean {
	return normalizeSettingsTheme(theme) === SETTINGS_THEME_SYSTEM;
}

export const SETTINGS_THEME_DARK_QUERY = '(prefers-color-scheme: dark)';

// Whether the desktop is asking for a dark UI right now.
//
// Falls back to dark, not light, when the query cannot be run at all: the
// console was dark for its whole life, so an environment that cannot answer
// keeps what it had rather than flipping to a white page. `matchMedia` exists in
// every browser this ships to; the guard is for the options page being loaded
// under a test harness that has no media-query implementation, where a thrown
// TypeError would otherwise take the whole console's startup with it.
export function systemPrefersDark(): boolean {
	try {
		if (typeof matchMedia !== 'function') return true;
		const query = matchMedia(SETTINGS_THEME_DARK_QUERY);
		return !query || typeof query.matches !== 'boolean' ? true : query.matches;
	} catch (e) {
		return true;
	}
}

// Choice in, paintable preset out. This is the value that belongs in
// `data-settings-theme` and nothing else does.
export function resolveSettingsTheme(theme: mixed, prefersDark: boolean = systemPrefersDark()): string {
	const choice = normalizeSettingsTheme(theme);
	if (choice !== SETTINGS_THEME_SYSTEM) return choice;
	return prefersDark ? SYSTEM_THEME_DARK : SYSTEM_THEME_LIGHT;
}

function preset(theme: mixed) {
	const resolved = resolveSettingsTheme(theme);
	return SETTINGS_THEME_PRESETS.find(({ id }) => id === resolved) || SETTINGS_THEME_PRESETS[0];
}

export function getSettingsThemeMetaColor(theme: mixed): string {
	return preset(theme).metaColor;
}

export function getSettingsThemeAccent(theme: mixed): string {
	return preset(theme).accent;
}
