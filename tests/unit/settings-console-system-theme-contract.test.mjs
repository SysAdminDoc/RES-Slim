import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

// The console has nine painted themes and one choice that is not a theme:
// `system`, which follows the desktop's colour scheme.
//
// The whole hazard is that a *choice* and a *preset* are both strings, so
// nothing stops `system` being written into `data-settings-theme`. Every theme
// block in options.scss is keyed on a preset id, so if that happened the console
// would silently fall through to the `:root` defaults, which is neither the
// light theme nor the dark one the reader asked for. These execute the bridge
// rather than reading it.

const themes = await loadFlowModule('lib/constants/settingsThemes.js', 'settings-system-theme');

const {
	DEFAULT_SETTINGS_THEME,
	SETTINGS_THEME_CHOICES,
	SETTINGS_THEME_DARK_QUERY,
	SETTINGS_THEME_PRESETS,
	SETTINGS_THEME_SYSTEM,
	SYSTEM_THEME_DARK,
	SYSTEM_THEME_LIGHT,
	getSettingsThemeAccent,
	getSettingsThemeMetaColor,
	isSystemSettingsTheme,
	normalizeSettingsTheme,
	resolveSettingsTheme,
	systemPrefersDark,
} = themes;

const presetIds = SETTINGS_THEME_PRESETS.map(({ id }) => id);

test('a fresh install follows the desktop instead of picking a side', () => {
	assert.equal(DEFAULT_SETTINGS_THEME, SETTINGS_THEME_SYSTEM);
	// And the default has to be an option the reader can see selected, or the
	// picker opens with nothing highlighted.
	assert.ok(SETTINGS_THEME_CHOICES.some(({ id }) => id === DEFAULT_SETTINGS_THEME));
});

test('the picker offers system alongside every painted preset, and nothing else', () => {
	assert.deepEqual(
		SETTINGS_THEME_CHOICES.map(({ id }) => id),
		[SETTINGS_THEME_SYSTEM, ...presetIds],
	);
	// `system` is not a preset. If it ever became one it would need a theme block
	// in options.scss, and it deliberately has none.
	assert.ok(!presetIds.includes(SETTINGS_THEME_SYSTEM));
	// Every choice carries a label key, or the picker renders a blank button.
	for (const choice of SETTINGS_THEME_CHOICES) {
		assert.match(choice.labelKey, /^settingsConsoleTheme/, `${choice.id} has no label key`);
	}
});

test('the two presets system resolves to exist and are opposite in polarity', () => {
	assert.ok(presetIds.includes(SYSTEM_THEME_LIGHT), 'the light resolution must be a real preset');
	assert.ok(presetIds.includes(SYSTEM_THEME_DARK), 'the dark resolution must be a real preset');
	assert.notEqual(SYSTEM_THEME_LIGHT, SYSTEM_THEME_DARK);

	// The light one has to actually be the light theme. `paper` is the only
	// preset that declares `color-scheme: light`, and picking a dark preset here
	// would make the whole feature a no-op that still passes every other test.
	const styles = readRepoFile('lib/options/options.scss');
	const lightBlock = styles.slice(styles.indexOf(`html[data-settings-theme='${SYSTEM_THEME_LIGHT}'] {`));
	assert.match(lightBlock.slice(0, lightBlock.indexOf('\n}')), /color-scheme:\s*light;/);
});

test('a choice resolves to something the stylesheet can actually paint', () => {
	assert.equal(resolveSettingsTheme(SETTINGS_THEME_SYSTEM, true), SYSTEM_THEME_DARK);
	assert.equal(resolveSettingsTheme(SETTINGS_THEME_SYSTEM, false), SYSTEM_THEME_LIGHT);

	// An explicit choice is not overridden by the desktop, in either direction.
	// This is the half readers notice: picking Rose Pine on a light laptop has to
	// stay Rose Pine.
	for (const id of presetIds) {
		assert.equal(resolveSettingsTheme(id, true), id);
		assert.equal(resolveSettingsTheme(id, false), id);
	}

	// And whatever comes out is always paintable.
	for (const choice of SETTINGS_THEME_CHOICES) {
		for (const dark of [true, false]) {
			assert.ok(presetIds.includes(resolveSettingsTheme(choice.id, dark)), `${choice.id} resolved to a non-preset`);
		}
	}
});

test('a stored value from another version does not leave the console unpainted', () => {
	// localStorage is a string store shared with whatever the next release
	// writes, and a downgrade is a real thing readers do.
	for (const junk of ['nord', '', 'SYSTEM', null, undefined, 42, {}, []]) {
		assert.equal(normalizeSettingsTheme(junk), DEFAULT_SETTINGS_THEME, `${String(junk)} should fall back`);
		assert.ok(presetIds.includes(resolveSettingsTheme(junk, true)));
		assert.ok(presetIds.includes(resolveSettingsTheme(junk, false)));
	}
	// Exact match only: the attribute selector in options.scss is exact too.
	assert.equal(normalizeSettingsTheme('system'), SETTINGS_THEME_SYSTEM);
	assert.equal(normalizeSettingsTheme(' system '), DEFAULT_SETTINGS_THEME);
});

test('isSystemSettingsTheme answers for the stored value, junk included', () => {
	assert.equal(isSystemSettingsTheme('system'), true);
	assert.equal(isSystemSettingsTheme('oled'), false);
	assert.equal(isSystemSettingsTheme('paper'), false);
	// Junk normalizes to the default, which is now `system` — so an unreadable
	// stored value follows the desktop rather than freezing on one theme.
	assert.equal(isSystemSettingsTheme('nord'), true);
});

test('the accent and the meta colour follow the resolution, not the raw choice', () => {
	// The permissions prompt reads both of these from a stored value that can say
	// `system`. Before this existed they went through `normalizeSettingsTheme`,
	// which would have handed `system` to a `.find` that matches nothing and
	// silently returned the first preset — the dark one, on a light desktop.
	const paper = SETTINGS_THEME_PRESETS.find(({ id }) => id === SYSTEM_THEME_LIGHT);
	const oled = SETTINGS_THEME_PRESETS.find(({ id }) => id === SYSTEM_THEME_DARK);
	assert.notEqual(paper.accent, oled.accent, 'this test is only meaningful if the two differ');

	withMatchMedia(false, () => {
		assert.equal(getSettingsThemeAccent(SETTINGS_THEME_SYSTEM), paper.accent);
		assert.equal(getSettingsThemeMetaColor(SETTINGS_THEME_SYSTEM), paper.metaColor);
	});
	withMatchMedia(true, () => {
		assert.equal(getSettingsThemeAccent(SETTINGS_THEME_SYSTEM), oled.accent);
		assert.equal(getSettingsThemeMetaColor(SETTINGS_THEME_SYSTEM), oled.metaColor);
	});
	// An explicit choice is still itself under either desktop.
	withMatchMedia(true, () => {
		assert.equal(getSettingsThemeAccent('rosepine'), '#c4a7e7');
	});
});

// Swap `matchMedia` for the duration of one body and put it back afterwards.
// Node has none of its own, so "put it back" usually means removing it again.
function withStubbedMatchMedia(stub, body) {
	const previous = globalThis.matchMedia;
	if (stub === undefined) delete globalThis.matchMedia;
	else globalThis.matchMedia = stub;
	try {
		body();
	} finally {
		if (previous === undefined) delete globalThis.matchMedia;
		else globalThis.matchMedia = previous;
	}
}

function withMatchMedia(matches, body) {
	withStubbedMatchMedia(query => {
		assert.equal(query, SETTINGS_THEME_DARK_QUERY, 'the dark query is the only one this asks about');
		return { matches, media: query, addEventListener() {}, removeEventListener() {} };
	}, body);
}

test('the desktop is read through the standard query, and a missing one keeps the old default', () => {
	withMatchMedia(true, () => assert.equal(systemPrefersDark(), true));
	withMatchMedia(false, () => assert.equal(systemPrefersDark(), false));

	// No matchMedia at all: the console was dark for its whole life, so falling
	// back to light here would flip an existing reader to a white page for a
	// reason that has nothing to do with what they want.
	const had = Object.hasOwn(globalThis, 'matchMedia');
	const previous = globalThis.matchMedia;
	delete globalThis.matchMedia;
	try {
		assert.equal(systemPrefersDark(), true);
		assert.equal(resolveSettingsTheme(SETTINGS_THEME_SYSTEM), SYSTEM_THEME_DARK);

		// A matchMedia that exists but throws, or answers with nothing usable, is
		// the same situation and must not take the console's startup with it.
		globalThis.matchMedia = () => { throw new TypeError('not implemented'); };
		assert.equal(systemPrefersDark(), true);
		globalThis.matchMedia = () => null;
		assert.equal(systemPrefersDark(), true);
		globalThis.matchMedia = () => ({ matches: 'yes' });
		assert.equal(systemPrefersDark(), true);
	} finally {
		if (had) globalThis.matchMedia = previous;
		else delete globalThis.matchMedia;
	}
});

// --- the console's own wiring --------------------------------------------------
//
// Whether the attribute flips live is a browser claim and is measured in
// tests/e2e against a real options page with an emulated colour scheme. What can
// be held here is that the console never writes a choice where a preset belongs,
// and that it persists the choice rather than the resolution — persisting the
// resolution would turn `system` into a one-time snapshot on the first click.

test('the console paints the resolution and stores the choice', () => {
	const controller = readRepoFile('lib/options/settingsConsole.js');

	assert.match(controller, /dataset\.settingsTheme = resolved;/, 'the attribute takes the resolved preset');
	assert.ok(
		!/dataset\.settingsTheme = (nextTheme|theme|choice|settingsThemeChoice)\b/.test(controller),
		'writing the choice into the attribute paints neither of the two themes it stands for',
	);
	assert.match(controller, /localStorage\.setItem\(SETTINGS_THEME_STORAGE_KEY, settingsThemeChoice\)/);
	// The picker highlights what was chosen. Highlighting the resolution would
	// light up Paper when the reader picked "Match system".
	assert.match(controller, /syncThemeSelector\(choice\)/);
});

test('a scheme change only repaints while the reader is actually following the system', () => {
	const controller = readRepoFile('lib/options/settingsConsole.js');
	const watcher = controller.slice(controller.indexOf('function watchSystemColorScheme'));
	const body = watcher.slice(0, watcher.indexOf('\n}\n'));

	assert.match(body, /if \(!isSystemSettingsTheme\(settingsThemeChoice\)\) return;/,
		'an explicit choice must survive the desktop changing underneath it');
	// Nothing is written back: the stored value stays `system` and the preset is
	// derived every time. Persisting here would silently convert the choice into
	// whichever theme happened to be showing when the OS changed.
	assert.ok(!/localStorage\.setItem/.test(body));
	// Both spellings, because this bundle also ships to Firefox and to older
	// engines where MediaQueryList has no addEventListener.
	assert.match(body, /addEventListener\('change', repaint\)/);
	assert.match(body, /addListener\(repaint\)/);
});
