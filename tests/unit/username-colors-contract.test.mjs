import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const uc = await loadFlowModule('lib/utils/usernameColors.js', 'username-colors');

function parseHsl(css) {
	const match = css.match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/);
	assert.ok(match, `not an hsl() string: ${css}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

test('the same username always produces the same colour', () => {
	// The userscripts this replaces reseed from Math.random on every load, so the
	// colour a reader has learned to associate with a person changes under them.
	const first = uc.colorForUsername('spez');
	for (let i = 0; i < 20; i++) assert.equal(uc.colorForUsername('spez'), first);
});

test('case and a u/ prefix do not change the colour', () => {
	assert.equal(uc.colorForUsername('SysAdminDoc'), uc.colorForUsername('sysadmindoc'));
	assert.equal(uc.hueForUsername('AutoWho'), uc.hueForUsername('autowho'));
});

test('different usernames mostly get different hues', () => {
	// Summing char codes — what the original scripts do — collides on every
	// anagram and on most short names. Check the hash actually spreads.
	const names = Array.from({ length: 400 }, (_, i) => `user_${i}`);
	const hues = new Set(names.map(n => uc.hueForUsername(n)));
	assert.ok(hues.size > 200, `only ${hues.size} distinct hues across 400 names`);

	// Anagrams specifically.
	assert.notEqual(uc.hueForUsername('abcd'), uc.hueForUsername('dcba'));
	assert.notEqual(uc.hueForUsername('ab'), uc.hueForUsername('ba'));
});

// Saturation is a user-editable option, so a band that only clears AA at the
// default value is not actually safe. Walk both dimensions.
function worstContrast(dark, background) {
	let worst = Infinity;
	let where = '';
	for (let saturation = 0; saturation <= 100; saturation += 2) {
		for (let hue = 0; hue < 360; hue++) {
			const css = uc.colorForUsername('x', { dark, saturation });
			// Use the real entry point, not the internals, so a clamp that exists
			// only in the test cannot make this pass.
			const [, s, l] = parseHsl(css);
			const ratio = uc.contrastRatio(uc.hslToRgb(hue, s, l), background);
			if (ratio < worst) { worst = ratio; where = `hue ${hue} at saturation ${saturation}`; }
		}
	}
	return { worst, where };
}

test('every hue at every saturation clears WCAG AA on a dark page', () => {
	// old.reddit's dark skins sit near #0e0e0e–#1a1a1a; pageTheme's OLED is #000.
	const { worst, where } = worstContrast(true, [16, 16, 16]);
	assert.ok(worst >= 4.5, `${where} only reaches ${worst.toFixed(2)}:1 on a dark page`);
});

test('every hue at every saturation clears WCAG AA on a white page', () => {
	// This is the one that caught the original band: yellow at L=32 reached only
	// 3.96:1, and raising saturation past 62 drops it to 3.2:1.
	const { worst, where } = worstContrast(false, [255, 255, 255]);
	assert.ok(worst >= 4.5, `${where} only reaches ${worst.toFixed(2)}:1 on a light page`);
});

test('the light band clamps saturation and the dark band does not', () => {
	const [, lightS] = parseHsl(uc.colorForUsername('x', { dark: false, saturation: 100 }));
	const [, darkS] = parseHsl(uc.colorForUsername('x', { dark: true, saturation: 100 }));
	assert.equal(lightS, uc.MAX_LIGHT_SATURATION);
	assert.equal(darkS, 100);
});

test('the contrast maths is not vacuously passing', () => {
	// If hslToRgb returned a constant, or contrastRatio always returned a big
	// number, both band tests above would pass while proving nothing.
	assert.deepEqual(uc.hslToRgb(0, 100, 50), [255, 0, 0]);
	assert.deepEqual(uc.hslToRgb(120, 100, 50), [0, 255, 0]);
	assert.equal(uc.contrastRatio([255, 255, 255], [0, 0, 0]).toFixed(0), '21');
	assert.equal(uc.contrastRatio([128, 128, 128], [128, 128, 128]).toFixed(2), '1.00');
	// A mid-grey on a dark page fails, so the assertions above can fail.
	assert.ok(uc.contrastRatio(uc.hslToRgb(0, 0, 30), [16, 16, 16]) < 4.5);
});

test('the palette option picks the band', () => {
	const [, , darkL] = parseHsl(uc.colorForUsername('someone', { dark: true }));
	const [, , lightL] = parseHsl(uc.colorForUsername('someone', { dark: false }));
	assert.equal(darkL, uc.DARK_THEME_LIGHTNESS);
	assert.equal(lightL, uc.LIGHT_THEME_LIGHTNESS);
});

test('reserved names are never recoloured', () => {
	assert.ok(uc.isReservedName('[deleted]'));
	assert.ok(uc.isReservedName('[removed]'));
	assert.ok(uc.isReservedName('AutoModerator'));
	assert.ok(uc.isReservedName(null));
	assert.ok(uc.isReservedName(''));
	assert.equal(uc.isReservedName('a_real_person'), false);
});

test('the module leaves reddit\'s own role colours alone', () => {
	// submitter / moderator / admin / friend are information the page is already
	// conveying with colour; overwriting them loses it.
	const mod = readRepoFile('lib/modules/usernameColors.js');
	assert.match(mod, /classList\.contains\('submitter'\)/);
	assert.match(mod, /classList\.contains\('moderator'\)/);
	assert.match(mod, /classList\.contains\('admin'\)/);
	assert.match(mod, /classList\.contains\('friend'\)/);
	assert.match(mod, /module\.disabledByDefault = true/);
});
