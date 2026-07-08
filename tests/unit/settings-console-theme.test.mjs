import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const themes = [
	'oled',
	'graphite',
	'midnight',
	'forest',
	'ember',
	'catppuccin',
	'tokyonight',
	'rosepine',
];

test('settings console theme picker is wired through template, controller, styles, and locale', () => {
	const template = read('lib/options/templates.js');
	const controller = read('lib/options/settingsConsole.js');
	const presets = read('lib/core/theme/settingsThemePresets.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(template, /id="RESThemeSelector"/);
	assert.match(template, /role="group"/);
	assert.match(template, /aria-pressed/);
	assert.match(template, /SETTINGS_THEME_PRESETS/);
	assert.match(controller, /SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme'/);
	assert.match(controller, /normalizeSettingsTheme/);
	assert.match(presets, /DEFAULT_SETTINGS_THEME = 'oled'/);

	for (const theme of themes) {
		assert.match(presets, new RegExp(`id: '${theme}'`));
		assert.match(presets, new RegExp(`'${theme}'[\\s\\S]*?metaColor: '#[0-9a-f]{6}'`, 'i'));
		assert.match(styles, new RegExp(`themeOptionSwatch--${theme}`));
	}

	for (const key of [
		'settingsConsoleThemeGroup',
		'settingsConsoleThemeLabel',
		'settingsConsoleThemeOled',
		'settingsConsoleThemeGraphite',
		'settingsConsoleThemeMidnight',
		'settingsConsoleThemeForest',
		'settingsConsoleThemeEmber',
		'settingsConsoleThemeCatppuccin',
		'settingsConsoleThemeTokyoNight',
		'settingsConsoleThemeRosePine',
		'settingsConsoleApplyTheme',
		'settingsConsoleAdvancedTag',
		'settingsConsoleDisplayGroup',
		'settingsConsoleSettingsFileGroup',
		'settingsConsoleChangesGroup',
	]) {
		assert.equal(typeof locale[key]?.message, 'string', `${key} should be localized`);
		assert.notEqual(locale[key].message.trim(), '', `${key} should not be empty`);
	}
});

test('non-default settings themes expose complete token overrides', () => {
	const styles = read('lib/options/options.scss');
	const requiredTokens = [
		'--options-bg',
		'--options-panel',
		'--options-panel-alt',
		'--options-panel-raised',
		'--options-field',
		'--options-field-hover',
		'--options-border',
		'--options-border-strong',
		'--options-text',
		'--options-text-muted',
		'--options-text-soft',
		'--options-accent',
		'--options-accent-soft',
		'--options-accent-strong',
	];

	for (const theme of themes.filter(theme => theme !== 'oled')) {
		const block = styles.match(new RegExp(`html\\[data-settings-theme='${theme}'\\] \\{([\\s\\S]*?)\\n\\}`));
		assert.ok(block, `${theme} theme should have a CSS block`);
		for (const token of requiredTokens) {
			assert.match(block[1], new RegExp(`${token}:`), `${theme} should override ${token}`);
		}
	}
});

test('default OLED theme is exposed via :root with full token set', () => {
	const styles = read('lib/options/options.scss');
	const requiredTokens = [
		'--options-bg',
		'--options-panel',
		'--options-panel-alt',
		'--options-panel-raised',
		'--options-field',
		'--options-field-hover',
		'--options-border',
		'--options-border-strong',
		'--options-text',
		'--options-text-muted',
		'--options-text-soft',
		'--options-accent',
		'--options-accent-soft',
		'--options-accent-strong',
		'--options-success',
		'--options-warning',
		'--options-danger',
	];
	const block = styles.match(/:root\s*\{([\s\S]*?)\n\}/);
	assert.ok(block, ':root token block should exist');
	for (const token of requiredTokens) {
		assert.match(block[1], new RegExp(`${token}:`), `:root should declare ${token}`);
	}
});

test('settings console exposes density toggle wiring and storage', () => {
	const template = read('lib/options/templates.js');
	const controller = read('lib/options/settingsConsole.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(template, /id="RESDensityToggle"/);
	assert.match(controller, /SETTINGS_DENSITY_STORAGE_KEY = 'res-settings-density'/);
	assert.match(controller, /dataset\.settingsDensity/);
	assert.match(styles, /\[data-settings-density='dense'\]/);
	assert.equal(typeof locale.settingsConsoleDenseMode?.message, 'string');
});

test('settings console paints branded scrollbars scoped to the console container', () => {
	const styles = read('lib/options/options.scss');
	assert.match(styles, /#RESConsoleContainer[\s\S]{0,200}scrollbar-color:/);
	assert.match(styles, /#RESConsoleContainer ::-webkit-scrollbar-thumb/);
});

test('settings console exposes a settings-toast helper used by every preference change', () => {
	const controller = read('lib/options/settingsConsole.js');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(controller, /function settingsToast\(/);
	for (const callSite of [
		'settingsToast(i18n(\'settingsConsoleToastThemeApplied\'',
		'settingsToast(i18n(nextDensity === SETTINGS_DENSITY_DENSE',
		'settingsToast(i18n(nextMotion === SETTINGS_MOTION_REDUCE',
		'settingsToast(i18n(enable ? \'settingsConsoleToastModuleEnabled\'',
		'settingsToast(i18n(\'settingsConsoleToastSaved\'))',
		'settingsToast(i18n(\'settingsConsoleToastReverted\'))',
	]) {
		assert.ok(controller.includes(callSite), `controller should toast: ${callSite}`);
	}

	for (const key of [
		'settingsConsoleToastThemeApplied',
		'settingsConsoleToastDensityDense',
		'settingsConsoleToastDensityComfortable',
		'settingsConsoleToastMotionReduced',
		'settingsConsoleToastMotionSystem',
		'settingsConsoleToastModuleEnabled',
		'settingsConsoleToastModuleDisabled',
		'settingsConsoleToastSaved',
		'settingsConsoleToastReverted',
		'settingsConsoleExportSuccess',
		'settingsConsoleImportSuccess',
	]) {
		assert.equal(typeof locale[key]?.message, 'string', `${key} should be localized`);
		assert.notEqual(locale[key].message.trim(), '', `${key} should not be empty`);
	}
});

test('settings console reduce-motion toggle is wired through template, controller, styles, and locale', () => {
	const template = read('lib/options/templates.js');
	const controller = read('lib/options/settingsConsole.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(template, /id="RESMotionToggle"/);
	assert.match(controller, /SETTINGS_MOTION_STORAGE_KEY = 'res-settings-motion'/);
	assert.match(controller, /SETTINGS_MOTION_REDUCE = 'reduce'/);
	assert.match(controller, /dataset\.reducedMotion/);
	assert.match(styles, /@mixin console-reduced-motion/);
	assert.match(styles, /html\[data-reduced-motion='reduce'\]/);
	assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}html:not\(\[data-reduced-motion='allow'\]\)/);
	assert.equal(typeof locale.settingsConsoleReduceMotion?.message, 'string');
	assert.equal(typeof locale.settingsConsoleReduceMotionActive?.message, 'string');
});

test('settings console uses the command-center utility rail layout', () => {
	const template = read('lib/options/templates.js');
	const controller = read('lib/options/settingsConsole.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(template, /id="RESConsoleUtilityRail"/);
	assert.match(template, /utilityPanel--status/);
	assert.match(template, /utilityPanel--display/);
	assert.match(template, /utilityPanel--data/);
	assert.match(template, /id="RESGlobalStageBar"[\s\S]*?class="globalStageBar/);
	assert.match(template, /id="RESThemeSelector"[\s\S]*?class="themeSelector/);
	assert.match(styles, /#RESConsoleContent[\s\S]{0,220}grid-template-columns: minmax\(270px, 312px\) minmax\(0, 1fr\) minmax\(284px, 328px\)/);
	assert.match(styles, /#RESConsoleUtilityRail[\s\S]{0,260}border-left: 1px solid var\(--options-border-strong\)/);
	assert.match(styles, /@media \(width <= 1240px\)[\s\S]{0,500}#RESConsoleUtilityRail/);
	assert.match(styles, /@media \(width <= 680px\)[\s\S]{0,160}html\[res-options\][\s\S]{0,420}#RESConsoleUtilityRail[\s\S]{0,120}grid-auto-flow: row/);
	assert.match(controller, /setSidebarCollapsed\(moduleID \? moduleID !== Search\.module\.moduleID : true\)/);

	for (const key of [
		'settingsConsoleUtilityRailAria',
		'settingsConsoleStatusTitle',
		'settingsConsoleStatusMeta',
		'settingsConsoleDisplayTitle',
		'settingsConsoleDisplayMeta',
		'settingsConsoleDataTitle',
		'settingsConsoleDataMeta',
		'settingsConsoleBuildLabel',
	]) {
		assert.equal(typeof locale[key]?.message, 'string', `${key} should be localized`);
		assert.notEqual(locale[key].message.trim(), '', `${key} should not be empty`);
	}
});
