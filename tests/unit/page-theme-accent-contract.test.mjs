// The accent colour is the one part of the page theme the user picks freely, and
// until now the only thing checked about it was that it parsed as a hex triple.
//
// `sanitizeAccent` cannot judge readability, because readability is not a
// property of the colour: the accent that ships is 8.4:1 on graphite and 4.8:1 on
// nord, against the same measurement. It is a property of the *pair*. So a user
// could set `#333` — about 1.2:1 against every shipped palette — and get visited
// post titles they cannot read and a `:focus-visible` outline they cannot see,
// with nothing anywhere telling them so. An invisible focus ring is a keyboard
// accessibility failure, and it is one the product let the user inflict on
// themselves silently.
//
// What is checked here:
//   1. The palette table the maths runs against still matches the stylesheet.
//      A palette edit that did not reach `PALETTE_SURFACES` would move the floor
//      without moving the measurement, which is this repo's signature defect
//      class (the Chrome manifest floor, the README counts, the repo
//      description).
//   2. The shipped default is compliant on every palette, so a correction is
//      never the normal case.
//   3. A deliberately dark accent triggers the fallback, and the fallback is
//      itself compliant — a correction that still fails is worse than none.
//   4. The stylesheet reads the corrected tokens for text and non-text, and the
//      raw accent only for decoration.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const scss = read('lib/css/modules/_pageTheme.scss');
const moduleSource = read('lib/modules/pageTheme.js');
const consoleSource = read('lib/options/settingsConsole.js');

const {
	PAGE_THEME_IDS,
	PALETTE_SURFACES,
	TEXT_CONTRAST_TARGET,
	NON_TEXT_CONTRAST_TARGET,
	GUARANTEED_CONTRAST_TOKEN,
	accentContrast,
	accentRoles,
	nearestReadableAccent,
	hexToRgb,
	rgbToHex,
	rgbToHsl,
} = await loadFlowModule('lib/utils/pageTheme.js', 'page-theme-accent', { deps: ['lib/utils/usernameColors.js'] });

// The default the option ships with.
const DEFAULT_ACCENT = (moduleSource.match(/type: 'color',\s*\n\s*value: '(#[0-9a-f]+)'/i) || [])[1];

function scssSurfaces(id) {
	const block = new RegExp(`html\\.res-pageTheme--${id}\\s*\\{([^}]*)\\}`).exec(scss);
	assert.ok(block, `no palette block for "${id}"`);
	const tokens = {};
	for (const [, name, value] of block[1].matchAll(/--(rsm-th-[a-z-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
	return [tokens['rsm-th-bg'], tokens['rsm-th-bg-elev'], tokens['rsm-th-bg-raise']];
}

test('the palette table the accent is measured against matches the stylesheet', () => {
	assert.deepEqual(
		Object.keys(PALETTE_SURFACES).sort(),
		PAGE_THEME_IDS.slice().sort(),
		'every selectable palette needs surfaces, or its accent is measured against the wrong ones',
	);

	for (const id of PAGE_THEME_IDS) {
		assert.deepEqual(
			PALETTE_SURFACES[id].slice(),
			scssSurfaces(id),
			`${id}: PALETTE_SURFACES has drifted from _pageTheme.scss — a palette edit that does not reach the table moves the floor without moving the measurement`,
		);
	}
});

test('the shipped default accent is readable on every palette', () => {
	assert.ok(DEFAULT_ACCENT, 'the accent option must ship a hex default');
	for (const id of PAGE_THEME_IDS) {
		const ratio = accentContrast(DEFAULT_ACCENT, id);
		assert.ok(
			ratio >= TEXT_CONTRAST_TARGET,
			`${id}: the default accent is ${ratio.toFixed(2)}:1, below ${TEXT_CONTRAST_TARGET}:1 — correction must be the exception, not the shipped state`,
		);
		const roles = accentRoles(DEFAULT_ACCENT, id);
		assert.equal(roles.textAdjusted, false);
		assert.equal(roles.focusAdjusted, false);
		assert.equal(roles.text, DEFAULT_ACCENT);
	}
});

test('a deliberately dark accent is corrected, on every palette, to something that passes', () => {
	// The roadmap named `#333` specifically: it ships about 1.2:1 and makes the
	// focus outline invisible.
	for (const accent of ['#333', '#000', '#1a1a2e']) {
		for (const id of PAGE_THEME_IDS) {
			const roles = accentRoles(accent, id);
			const raw = accentContrast(accent, id);

			assert.equal(roles.accent, accent, 'the raw accent is kept for the decorative color-mix blends');
			assert.ok(raw < TEXT_CONTRAST_TARGET, `${accent} on ${id} should be failing to begin with, it is ${raw.toFixed(2)}:1`);
			assert.equal(roles.textAdjusted, true, `${accent} on ${id}: text must be corrected`);

			// The correction has to actually clear the bar it was made for.
			if (roles.text !== GUARANTEED_CONTRAST_TOKEN) {
				const corrected = accentContrast(roles.text, id);
				assert.ok(
					corrected >= TEXT_CONTRAST_TARGET,
					`${accent} on ${id}: corrected to ${roles.text} at ${corrected.toFixed(2)}:1, which still fails`,
				);
			}
			if (roles.focus !== GUARANTEED_CONTRAST_TOKEN) {
				const corrected = accentContrast(roles.focus, id);
				assert.ok(
					corrected >= NON_TEXT_CONTRAST_TARGET,
					`${accent} on ${id}: focus corrected to ${roles.focus} at ${corrected.toFixed(2)}:1, which still fails`,
				);
			}
		}
	}
});

test('the correction keeps the hue the user chose', () => {
	// Snapping every failing accent to white would pass the maths and throw away
	// the setting. A dark red must come back a lighter red.
	const corrected = nearestReadableAccent('#4a0f0f', 'graphite', TEXT_CONTRAST_TARGET);
	assert.ok(corrected, 'a dark red must be liftable');
	const [h] = rgbToHsl(hexToRgb(corrected));
	const [originalHue] = rgbToHsl(hexToRgb('#4a0f0f'));
	assert.ok(Math.abs(h - originalHue) < 1, `hue moved from ${originalHue} to ${h}`);
	assert.ok(accentContrast(corrected, 'graphite') >= TEXT_CONTRAST_TARGET);
});

test('an accent that is already compliant is returned untouched', () => {
	assert.equal(nearestReadableAccent('#ffffff', 'graphite'), '#ffffff');
	// Shorthand and alpha forms normalise rather than being rejected outright.
	assert.equal(rgbToHex(hexToRgb('#fff')), '#ffffff');
	assert.deepEqual(hexToRgb('#5aa9ffcc'), hexToRgb('#5aa9ff'));
	assert.equal(hexToRgb('not a colour'), null);
});

test('a value the picker cannot produce yields no accent at all rather than a broken one', () => {
	const roles = accentRoles('rgb(1,2,3)', 'graphite');
	assert.equal(roles.accent, null);
	assert.equal(roles.text, null);
	assert.equal(roles.focus, null);
	assert.equal(roles.ratio, 0);
});

test('the stylesheet paints text and non-text from the corrected tokens', () => {
	// The raw `--rsm-th-accent` may only appear inside `color-mix()`, where it is
	// blended into a background at 14-50% and is decorative. Any bare use as a
	// `color`, `outline` or `accent-color` is a readability surface.
	const offenders = [];
	for (const line of scss.split(/\r?\n/)) {
		if (!/var\(--rsm-th-accent\)/.test(line)) continue;
		if (/color-mix\(/.test(line)) continue;
		if (/--rsm-th-accent-(text|ui):/.test(line)) continue;
		offenders.push(line.trim());
	}
	assert.deepEqual(offenders, [], 'these paint the raw accent directly; they must read --rsm-th-accent-text or --rsm-th-accent-ui');

	assert.match(scss, /outline: 2px solid var\(--rsm-th-accent-ui\)/, 'the focus outline is the non-text surface that matters most');
	assert.match(scss, /--rsm-th-accent-text: var\(--rsm-th-accent\);/, 'the tokens need a pre-module default, or the theme paints nothing before onInit');
	assert.match(scss, /--rsm-th-accent-ui: var\(--rsm-th-accent\);/);
});

test('the module writes all three accent roles, and clears all three', () => {
	assert.match(moduleSource, /el\.style\.setProperty\('--rsm-th-accent-text', roles\.text\)/);
	assert.match(moduleSource, /el\.style\.setProperty\('--rsm-th-accent-ui', roles\.focus\)/);
	// Clearing only the raw accent would leave a corrected shade painted after the
	// module is switched off.
	assert.match(moduleSource, /for \(const prop of ACCENT_PROPERTIES\) el\.style\.removeProperty\(prop\)/);
	// The correction depends on the palette, so replaying the cache without it
	// would paint a shade the authoritative pass then changes.
	assert.match(moduleSource, /JSON\.stringify\(\{ classes, accent, theme \}\)/);
});

test('the settings console tells the user, and offers the fix rather than applying it', () => {
	assert.match(moduleSource, /advise\(value: mixed, values: \{ \[string\]: mixed \}\)/, 'the accent option must declare advice');
	assert.match(consoleSource, /typeof option\.advise !== 'function'/, 'the console must render it');
	assert.match(consoleSource, /RESConsoleContainer\.addEventListener\('input', refreshOptionAdvice\)/, 'advice must track unsaved edits — the palette above it is what changes the verdict');
	assert.match(consoleSource, /optionAdviceEntries\.length = 0;/, 'the notes belong to the rows being torn down');
});
