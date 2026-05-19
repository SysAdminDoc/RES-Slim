/* @flow */

export const DEFAULT_SETTINGS_THEME = 'oled';

export const SETTINGS_THEME_PRESETS = Object.freeze([
	{ id: 'oled', labelKey: 'settingsConsoleThemeOled', metaColor: '#050608' },
	{ id: 'graphite', labelKey: 'settingsConsoleThemeGraphite', metaColor: '#0d1117' },
	{ id: 'midnight', labelKey: 'settingsConsoleThemeMidnight', metaColor: '#08131f' },
	{ id: 'forest', labelKey: 'settingsConsoleThemeForest', metaColor: '#0d1712' },
	{ id: 'ember', labelKey: 'settingsConsoleThemeEmber', metaColor: '#1a1210' },
]);

const settingsThemeIds = new Set(SETTINGS_THEME_PRESETS.map(({ id }) => id));

export function normalizeSettingsTheme(theme) {
	return settingsThemeIds.has(theme) ? theme : DEFAULT_SETTINGS_THEME;
}

export function getSettingsThemeMetaColor(theme) {
	const normalized = normalizeSettingsTheme(theme);
	const preset = SETTINGS_THEME_PRESETS.find(({ id }) => id === normalized);
	return preset ? preset.metaColor : SETTINGS_THEME_PRESETS[0].metaColor;
}
