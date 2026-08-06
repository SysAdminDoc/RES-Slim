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
	const presets = read('lib/constants/settingsThemes.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(template, /id="RESThemeSelector"/);
	assert.match(template, /role="group"/);
	assert.match(template, /aria-pressed/);
	assert.match(template, /SETTINGS_THEME_PRESETS/);
	// The storage key lives in the shared presets module so the permissions
	// prompt can read the same value and paint itself with the chosen accent,
	// rather than each surface hardcoding its own copy.
	assert.match(read('lib/constants/settingsThemes.js'), /SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme'/);
	assert.match(controller, /SETTINGS_THEME_STORAGE_KEY,/);
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
		// --options-accent-soft is deliberately absent: it and the other accent
		// tints are derived once in :root from --options-accent, so a theme that
		// redeclared it would opt itself out of the derivation.
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

test('console-level controls live in the Console tab, not a third column', () => {
	// These panels used to sit in a permanent right-hand rail, which put four
	// separate control regions on screen at once. The panels survive; the rail
	// does not.
	const template = read('lib/options/templates.js');
	const controller = read('lib/options/settingsConsole.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.doesNotMatch(template, /RESConsoleUtilityRail/);
	assert.doesNotMatch(styles, /RESConsoleUtilityRail/);

	assert.match(template, /id="RESConsolePrefs"[\s\S]{0,200}role="tabpanel"[\s\S]{0,40}hidden/);
	assert.match(template, /utilityPanel--display/);
	assert.match(template, /utilityPanel--data/);
	assert.match(template, /utilityPanel--advanced/);
	assert.match(template, /utilityPanel--build/);
	assert.match(template, /id="RESThemeSelector"[\s\S]*?class="themeSelector/);

	// Save state stays in the header, visible from every tab — parking it
	// behind the Console tab would hide unsaved changes.
	assert.match(template, /class="consoleHeaderActions"[\s\S]{0,600}id="RESGlobalStageBar"/);
	assert.match(template, /class="consoleHeaderActions"[\s\S]{0,900}id="RESGlobalSave"/);

	assert.match(styles, /#RESConsoleContent[\s\S]{0,220}grid-template-columns: minmax\(270px, 312px\) minmax\(0, 1fr\);/);
	assert.match(controller, /setSidebarCollapsed\(moduleID \? moduleID !== Search\.module\.moduleID : true\)/);

	for (const key of [
		'settingsConsoleDisplayTitle',
		'settingsConsoleDisplayMeta',
		'settingsConsoleDataTitle',
		'settingsConsoleDataMeta',
		'settingsConsoleBuildLabel',
		'settingsConsoleConsolePrefsTitle',
		'settingsConsoleConsolePrefsSummary',
	]) {
		assert.equal(typeof locale[key]?.message, 'string', `${key} should be localized`);
		assert.notEqual(locale[key].message.trim(), '', `${key} should not be empty`);
	}
});

test("night mode's blanket button rule cannot reach into the settings console", () => {
	// res.css is loaded on the options page and <html> carries res-nightmode, so
	// `.res-nightmode button` (0,1,1) outranked every class-based button style in
	// options.scss (0,1,0). The filter chips, theme swatches, Export/Import and
	// the category tabs all rendered as grey outset UA buttons because of it.
	// The exclusion lives in :where() so Reddit's own buttons keep their
	// specificity and their look.
	const nightMode = read('lib/css/modules/_nightMode.scss');
	const rule = nightMode.slice(
		nightMode.indexOf("button:not(:where(#RESConsoleContainer *))"),
		nightMode.indexOf('background-color: hsl(0, 0%, 30%);') + 40,
	);

	assert.ok(rule, 'the night-mode button rule should still exist');
	for (const selector of ['button', "input[type='button']", "input[type='submit']", "input[type='reset']"]) {
		assert.ok(
			rule.includes(`${selector}:not(:where(#RESConsoleContainer *))`),
			`${selector} must exclude the settings console`,
		);
	}
	// Bare `:not(#RESConsoleContainer *)` would add an ID to the selector and
	// make the rule stronger on Reddit, which is the opposite of the intent.
	assert.doesNotMatch(rule, /:not\(#RESConsoleContainer/);
});
