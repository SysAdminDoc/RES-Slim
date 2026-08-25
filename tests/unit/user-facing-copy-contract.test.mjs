// House style for anything a reader sees.
//
// The rules live in the repo owner's global instructions and were applied by
// hand up to now, which is why 62 em dashes accumulated across module
// descriptions, option help, toasts and aria-labels, and why the settings list
// ended up showing "Color-coded comment depth" one row above "Colour usernames".
//
// A style rule nothing checks drifts exactly like the copy it polices - this
// repo has already learnt that once, recorded in CLAUDE.md as "a forbidden-phrase
// list drifts exactly like the copy it polices". So this checks the two rules
// that are mechanical and unambiguous, and nothing else:
//
//   1. no em or en dash in a string a reader sees;
//   2. one spelling of the words this product actually uses.
//
// Deliberately NOT checked: sentence length, contractions, rule-of-three lists,
// or a banned-vocabulary list. Those need judgement, a regex gets them wrong in
// both directions, and a check that cries wolf gets deleted.
//
// Code comments are exempt and there are thousands of them, so every scan here
// reads string literals on user-facing fields rather than whole lines.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

function jsFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return jsFiles(full);
		return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
	});
}

// A string literal assigned to a field a reader sees. Anchored on the field name
// so a comment, a selector or an internal constant is never scanned.
const USER_FACING = /(?:module\.moduleName|module\.description|\btitle|\bdescription|\bplaceholder|\baria-label|\blabel)\s*[:=]\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

function userFacingStrings() {
	const found = [];
	for (const file of jsFiles(path.join(repoRoot, 'lib'))) {
		const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
		const source = fs.readFileSync(file, 'utf8');
		for (const [, , value] of source.matchAll(USER_FACING)) {
			if (value) found.push({ file: relative, value });
		}
	}
	const locale = JSON.parse(fs.readFileSync(path.join(repoRoot, 'locales', 'locales', 'en.json'), 'utf8'));
	for (const [key, entry] of Object.entries(locale)) {
		if (entry && typeof entry.message === 'string') found.push({ file: `en.json:${key}`, value: entry.message });
	}
	return found;
}

const STRINGS = userFacingStrings();

test('the scan actually finds the strings it is meant to police', () => {
	// A scan that matches nothing passes forever. These two are load-bearing:
	// one module description and one locale message, both known to exist.
	assert.ok(STRINGS.length > 500, `expected the full copy surface, found ${STRINGS.length}`);
	assert.ok(STRINGS.some(s => s.file.startsWith('en.json:')), 'locale messages must be included');
	assert.ok(STRINGS.some(s => s.file.startsWith('lib/modules/')), 'module fields must be included');
});

test('no user-facing string contains an em or en dash', () => {
	const offenders = STRINGS
		.filter(({ value }) => value.includes(EM_DASH) || value.includes(EN_DASH))
		.map(({ file, value }) => `${file}: ${value.slice(0, 70)}`);
	assert.deepEqual(offenders, [], `dashes in copy a reader sees:\n  ${offenders.join('\n  ')}`);
});

test('no user-facing string uses a spaced hyphen as a dash', () => {
	// A hyphen joins a compound word. Spaced, it is a dash wearing a disguise.
	const offenders = STRINGS
		.filter(({ value }) => / - /.test(value))
		.map(({ file, value }) => `${file}: ${value.slice(0, 70)}`);
	assert.deepEqual(offenders, [], `spaced hyphens standing in for dashes:\n  ${offenders.join('\n  ')}`);
});

test('one spelling, and it is the one the locale catalog already uses', () => {
	// "Color-coded comment depth" and "Colour usernames" were two module names a
	// row apart in the settings list, and userTagger shipped "Colorise", "Colour"
	// and "colour" within twenty lines.
	const BRITISH = /\b(colour|colours|coloured|colouring|colourise|colorise|behaviour|behaviours|normalise|normalised|normalises|honour|honours|browseable)\b/i;
	const offenders = STRINGS
		.filter(({ value }) => BRITISH.test(value))
		.map(({ file, value }) => `${file}: ${BRITISH.exec(value)[0]} in "${value.slice(0, 50)}"`);
	assert.deepEqual(offenders, [], `mixed spelling in copy a reader sees:\n  ${offenders.join('\n  ')}`);
});

test('one apostrophe character and one ellipsis character', () => {
	const CURLY = String.fromCharCode(0x2019);
	const curly = STRINGS.filter(({ value }) => value.includes(CURLY))
		.map(({ file, value }) => `${file}: ${value.slice(0, 60)}`);
	assert.deepEqual(curly, [], `curly apostrophes where the rest of the product uses a straight one:\n  ${curly.join('\n  ')}`);

	// Prose only. Two legitimate uses would otherwise be caught: `fixProcessingImg`
	// quotes reddit's own "Processing img abc123..." placeholder, where changing
	// the character would misquote it, and the user-tag import help shows a JSON
	// example whose `"..."` is a code placeholder rather than a pause. Neither
	// string is plain prose, so the presence of a brace or an inner quote is the
	// discriminator.
	const ascii = STRINGS
		.filter(({ value }) => value.includes('...'))
		.filter(({ value }) => !/[{}"]/.test(value))
		.map(({ file, value }) => `${file}: ${value.slice(0, 60)}`);
	assert.deepEqual(ascii, [], `three dots where the rest of the product uses a single ellipsis:\n  ${ascii.join('\n  ')}`);
});
