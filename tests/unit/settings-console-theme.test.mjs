import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const themes = [
	'oled',
	'paper',
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
	// The picker renders the choices, which is the nine presets plus `system`.
	// `SETTINGS_THEME_PRESETS` is the paintable list and is deliberately not what
	// the template maps over any more.
	assert.match(template, /SETTINGS_THEME_CHOICES/);
	// The storage key lives in the shared presets module so the permissions
	// prompt can read the same value and paint itself with the chosen accent,
	// rather than each surface hardcoding its own copy.
	assert.match(read('lib/constants/settingsThemes.js'), /SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme'/);
	assert.match(controller, /SETTINGS_THEME_STORAGE_KEY,/);
	assert.match(controller, /normalizeSettingsTheme/);
	// The default was `oled` until v0.53.0, which meant a reader on a light
	// desktop opened a black settings page. It is now the `system` choice, which
	// resolves to `oled` on a dark desktop — so nothing changes for the readers
	// who were happy, and a light desktop gets `paper`. The old assertion is not
	// wrong about the code, it encodes a product decision that was reversed.
	assert.match(presets, /DEFAULT_SETTINGS_THEME = SETTINGS_THEME_SYSTEM/);
	assert.match(presets, /SETTINGS_THEME_SYSTEM = 'system'/);

	for (const theme of themes) {
		assert.match(presets, new RegExp(`id: '${theme}'`));
		assert.match(presets, new RegExp(`'${theme}'[\\s\\S]*?metaColor: '#[0-9a-f]{6}'`, 'i'));
		assert.match(styles, new RegExp(`themeOptionSwatch--${theme}`));
	}

	for (const key of [
		'settingsConsoleThemeGroup',
		'settingsConsoleThemeLabel',
		'settingsConsoleThemeOled',
		'settingsConsoleThemePaper',
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

test('settings console reports through one replaceable status line, not the notification stack', () => {
	const controller = read('lib/options/settingsConsole.js');
	const markup = read('lib/options/templates.js');
	const locale = JSON.parse(read('locales/locales/en.json'));

	// This used to assert that every one of these went through `settingsToast`,
	// which called `showNotification`. That was the defect, not the design:
	// `showNotification` prepends a card and deduplicates only on identical HTML,
	// so clicking through the theme picker stacked one three-row card per click
	// over the Advanced switch and the support report's Copy button, and each
	// card offered to disable a "notification type" that is really this console
	// talking to itself.
	assert.match(controller, /function settingsStatus\(/);
	assert.ok(!/function settingsToast\(/.test(controller), 'the notification-stack helper is gone');
	assert.match(markup, /id="RESConsoleStatus"[^>]*role="status"/, 'the chip has to exist and announce itself');

	// One element, cleared and rewritten, so a second message replaces the first
	// rather than joining it.
	assert.match(controller, /clearTimeout\(settingsStatusTimer\)/);
	assert.match(controller, /chip\.textContent = message;/);

	// Unhidden before the text is written. A live region populated while it is
	// `display: none` is outside the accessibility tree, and screen readers
	// commonly do not announce the change when it is revealed afterwards.
	const body = controller.slice(controller.indexOf('function settingsStatus('));
	assert.ok(body.indexOf('chip.hidden = false;') < body.indexOf('chip.textContent = message;'),
		'the region has to exist before it is given something to announce');

	// A failure says so. `is-error` was declared in the stylesheet and set by
	// nothing, so "Copy failed. …" rendered in the same muted grey as a success.
	assert.match(controller, /isError: true/, 'the failure messages have to be marked as failures');

	// And it wraps rather than truncating: the longest of these is 72 characters
	// and the actionable half is at the end.
	const chipRule = read('lib/options/options.scss');
	const chipStart = chipRule.indexOf('.consoleStatusChip {');
	assert.notEqual(chipStart, -1, 'the chip must have a rule of its own');
	const chipBlock = chipRule.slice(chipStart, chipRule.indexOf('\n}', chipStart));
	assert.match(chipBlock, /&\.is-error/, 'and a failure has to look different from a success');
	assert.ok(!/white-space:\s*nowrap/.test(chipBlock), 'a truncated failure message loses the part that helps');
	assert.match(chipBlock, /flex: 0 0 100%/, 'the chip takes its own line rather than displacing the buttons');

	// A theme change says nothing at all: the picker's selected state is the
	// feedback, and it was the single biggest source of the stack.
	assert.ok(!/settingsThemeChoice\)\);/.test(controller), 'choosing a theme must not raise a message');
	assert.equal(locale.settingsConsoleToastThemeApplied, undefined, 'and its string is gone with it');

	for (const callSite of [
		'settingsStatus(i18n(nextDensity === SETTINGS_DENSITY_DENSE',
		'settingsStatus(i18n(nextMotion === SETTINGS_MOTION_REDUCE',
		'settingsStatus(i18n(enable ? \'settingsConsoleToastModuleEnabled\'',
		'settingsStatus(i18n(\'settingsConsoleToastSaved\'))',
		'settingsStatus(i18n(\'settingsConsoleToastReverted\'))',
	]) {
		assert.ok(controller.includes(callSite), `controller should report: ${callSite}`);
	}

	for (const key of [
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
	assert.match(controller, /setSidebarCollapsed\(moduleID \? moduleID !== SEARCH_MODULE_ID : true\)/);

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

test('night mode\'s blanket button rule cannot reach into the settings console', () => {
	// res.css is loaded on the options page and <html> carries res-nightmode, so
	// `.res-nightmode button` (0,1,1) outranked every class-based button style in
	// options.scss (0,1,0). The filter chips, theme swatches, Export/Import and
	// the category tabs all rendered as grey outset UA buttons because of it.
	// The exclusion lives in :where() so Reddit's own buttons keep their
	// specificity and their look.
	// The exclusion list has since grown - RES-Slim's own injected controls were
	// being repainted by this rule too, most visibly the thread minimap's stripes,
	// whose entire information channel is their background colour. So this matches
	// the shape rather than one exact spelling of the list: pinning the literal
	// meant a correct widening of the exclusion read as a regression.
	const nightMode = read('lib/css/modules/_nightMode.scss');
	const start = nightMode.indexOf('button:not(:where(#RESConsoleContainer *');
	assert.notEqual(start, -1, 'the night-mode button rule should still exist');
	const rule = nightMode.slice(start, nightMode.indexOf('background-color: hsl(0, 0%, 30%);', start) + 40);

	for (const selector of ['button', 'input[type=\'button\']', 'input[type=\'submit\']', 'input[type=\'reset\']']) {
		const excluded = new RegExp(
			`${selector.replace(/[[\]']/g, m => `\\${m}`)}:not\\(:where\\([^)]*#RESConsoleContainer \\*`,
		);
		assert.match(rule, excluded, `${selector} must exclude the settings console`);
	}
	// Bare `:not(#RESConsoleContainer *)` would add an ID to the selector and
	// make the rule stronger on Reddit, which is the opposite of the intent.
	assert.doesNotMatch(rule, /:not\(#RESConsoleContainer/);
});
