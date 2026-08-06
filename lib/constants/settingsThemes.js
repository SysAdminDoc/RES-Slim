/* @flow */

export const DEFAULT_SETTINGS_THEME = 'oled';

// Where the settings console persists the chosen theme. The permissions prompt
// is served from the same extension origin, so it can read this directly and
// paint itself with the same accent instead of always using graphite's blue.
export const SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme';

// `accent` mirrors --options-accent in options.scss. Both surfaces read it from
// here so a theme's accent is defined once; options.scss derives every tint from
// its own copy via color-mix, and the prompt page sets this one inline.
export const SETTINGS_THEME_PRESETS = Object.freeze([
	{ id: 'oled', labelKey: 'settingsConsoleThemeOled', metaColor: '#050608', accent: '#ff7a18' },
	{ id: 'graphite', labelKey: 'settingsConsoleThemeGraphite', metaColor: '#0d1117', accent: '#58a6ff' },
	{ id: 'midnight', labelKey: 'settingsConsoleThemeMidnight', metaColor: '#08131f', accent: '#58c3ff' },
	{ id: 'forest', labelKey: 'settingsConsoleThemeForest', metaColor: '#0d1712', accent: '#4ed59a' },
	{ id: 'ember', labelKey: 'settingsConsoleThemeEmber', metaColor: '#1a1210', accent: '#ff9b57' },
	{ id: 'catppuccin', labelKey: 'settingsConsoleThemeCatppuccin', metaColor: '#1e1e2e', accent: '#cba6f7' },
	{ id: 'tokyonight', labelKey: 'settingsConsoleThemeTokyoNight', metaColor: '#1a1b26', accent: '#7aa2f7' },
	{ id: 'rosepine', labelKey: 'settingsConsoleThemeRosePine', metaColor: '#191724', accent: '#c4a7e7' },
]);

const settingsThemeIds = new Set(SETTINGS_THEME_PRESETS.map(({ id }) => id));

export function normalizeSettingsTheme(theme: mixed): string {
	return typeof theme === 'string' && settingsThemeIds.has(theme) ? theme : DEFAULT_SETTINGS_THEME;
}

function preset(theme: mixed) {
	const normalized = normalizeSettingsTheme(theme);
	return SETTINGS_THEME_PRESETS.find(({ id }) => id === normalized) || SETTINGS_THEME_PRESETS[0];
}

export function getSettingsThemeMetaColor(theme: mixed): string {
	return preset(theme).metaColor;
}

export function getSettingsThemeAccent(theme: mixed): string {
	return preset(theme).accent;
}
