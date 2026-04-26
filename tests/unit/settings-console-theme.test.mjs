import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const themes = [
	'graphite',
	'midnight',
	'forest',
	'ember',
];

test('settings console theme picker is wired through template, controller, styles, and locale', () => {
	const template = read('lib/options/templates.js');
	const controller = read('lib/options/settingsConsole.js');
	const styles = read('lib/options/options.scss');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(template, /id="RESThemeSelector"/);
	assert.match(template, /role="group"/);
	assert.match(template, /aria-pressed/);
	assert.match(controller, /SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme'/);

	for (const theme of themes) {
		assert.match(template, new RegExp(`id: '${theme}'`));
		assert.match(controller, new RegExp(`${theme}: '#[0-9a-f]{6}'`, 'i'));
		assert.match(styles, new RegExp(`themeOptionSwatch--${theme}`));
	}

	for (const key of [
		'settingsConsoleThemeGroup',
		'settingsConsoleThemeLabel',
		'settingsConsoleThemeGraphite',
		'settingsConsoleThemeMidnight',
		'settingsConsoleThemeForest',
		'settingsConsoleThemeEmber',
		'settingsConsoleApplyTheme',
		'settingsConsoleAdvancedTag',
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

	for (const theme of themes.filter(theme => theme !== 'graphite')) {
		const block = styles.match(new RegExp(`html\\[data-settings-theme='${theme}'\\] \\{([\\s\\S]*?)\\n\\}`));
		assert.ok(block, `${theme} theme should have a CSS block`);
		for (const token of requiredTokens) {
			assert.match(block[1], new RegExp(`${token}:`), `${theme} should override ${token}`);
		}
	}
});
