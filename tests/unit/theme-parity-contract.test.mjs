import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

// The two renderers are supposed to look like one product. Until v0.45.0 they
// only did on one palette out of eleven: the old-Reddit classic geometry and the
// whole current-Reddit parity layer were both gated on
// `.res-pageTheme--classic.res-pageTheme--refined`, so picking any dark palette
// dropped every measurement the parity pass established and left current Reddit
// with Reddit's own layout in slightly different colours.
//
// The gate is the *layout* toggle. The palette decides colour and nothing else.

const scss = read('lib/css/modules/_pageTheme.scss');
const shreddit = read('lib/utils/shreddit.js');

const PALETTES = [
	'classic', 'oled', 'graphite', 'midnight', 'catppuccin', 'tokyonight',
	'rosepine', 'nord', 'dracula', 'gruvbox', 'solarized',
];

test('the palette option and the stylesheet agree on which palettes exist', () => {
	const module = read('lib/modules/pageTheme.js');
	const declared = [...module.matchAll(/\{ name: '[^']+', value: '([a-z]+)' \}/g)].map(m => m[1]);
	assert.deepEqual(declared, PALETTES, 'the palette list in pageTheme.js drifted from this contract');
	for (const palette of PALETTES) {
		assert.ok(scss.includes(`html.res-pageTheme--${palette} {`), `no token block for ${palette}`);
	}
});

test('every palette defines every token the shared layout reads', () => {
	// A layout rule that reads `var(--rsm-th-header)` renders with *nothing* on a
	// palette that never defines it. That is precisely what made these tokens
	// safe to add for Classic alone and unsafe to rely on anywhere else.
	const REQUIRED = [
		'--rsm-th-bg', '--rsm-th-bg-elev', '--rsm-th-bg-raise',
		'--rsm-th-txt', '--rsm-th-txt-strong', '--rsm-th-link', '--rsm-th-muted',
		'--rsm-th-border', '--rsm-th-control-border',
		'--rsm-th-header', '--rsm-th-shadow', '--rsm-th-scheme',
	];
	const missing = [];
	for (const palette of PALETTES) {
		const block = new RegExp(`html\\.res-pageTheme--${palette} \\{([\\s\\S]*?)\\n\\}`).exec(scss);
		assert.ok(block, `no token block for ${palette}`);
		for (const token of REQUIRED) {
			if (!new RegExp(`^\\t${token}:`, 'm').test(block[1])) missing.push(`${palette} is missing ${token}`);
		}
	}
	assert.deepEqual(missing, [], `palettes missing tokens:\n  ${missing.join('\n  ')}`);
});

test('no layout rule is gated on a single palette', () => {
	// `--classic` may appear only where it defines its own tokens. Any *rule*
	// scoped to one palette is a layout decision that ten other palettes do not
	// get, which is the defect this file exists for.
	// Only the palette names count. `--refined.--collapse-sidebar` and
	// `--refined.--declutter` are combinations of *toggles*, which is exactly how
	// an optional layout is supposed to be scoped.
	const offenders = [...scss.matchAll(/^html\.res-pageTheme--([a-z]+)\.res-pageTheme--[\w-]+[^\n]*/gm)]
		.filter(m => PALETTES.includes(m[1]))
		.map(m => m[0].replace(/\s*[,{]$/, ''));
	assert.deepEqual(offenders, [],
		`these rules apply to one palette only; gate on .res-pageTheme.res-pageTheme--refined instead:\n  ${offenders.join('\n  ')}`);
});

test('the parity rules keep the specificity that lets them win', () => {
	// They were written with two classes deliberately, to outrank the generic
	// refined-layout rules further down the file. Dropping to one class hands
	// that fight to the generic layer on source order and silently loses the
	// measured geometry.
	const twoClass = (scss.match(/^html\.res-pageTheme\.res-pageTheme--refined/gm) || []).length;
	assert.ok(twoClass >= 60, `expected the parity layer to survive, found ${twoClass} two-class rules`);

	// And the geometry those rules carry, which is what "looks like old Reddit"
	// actually means. These numbers come from the archived renderer.
	for (const [what, pattern] of [
		['72px listing rows', /min-height: 72px;/],
		['43px vote rail', /width: 43px;/],
		['70px thumbnails', /width: 70px;\n\theight: 70px;/],
		['300px information rail', /width: 300px;/],
		['46px current-Reddit header', /--shreddit-header-height: 46px;/],
	]) {
		assert.match(scss, pattern, `the parity layer lost its ${what}`);
	}
});

test('shadow geometry follows the layout toggle while part paint follows the palette', () => {
	// Structural selectors stay inside the root because ::part() cannot express
	// the relationships that move Reddit's action row into the left vote rail.
	assert.doesNotMatch(shreddit, /res-pageTheme--classic/,
		'the shadow stylesheet is gated on the Classic palette, so dark palettes get no vote rail');
	assert.match(shreddit, /:host-context\(html\.res-pageTheme\.res-pageTheme--refined\)/);
	assert.match(shreddit, /position: absolute !important/);

	// Paint and icon sizing are shared once in the document sheet. The injected
	// per-host sheet must not duplicate palette declarations.
	assert.doesNotMatch(shreddit, /var\(--rsm-th-/);
	assert.match(scss, /shreddit-post::part\(rsm-vote-button\)/);
	assert.match(scss, /shreddit-post::part\(rsm-action-icon\)/);
	for (const token of ['--rsm-th-muted', '--rsm-th-txt', '--rsm-th-link']) {
		assert.ok(scss.includes(`var(${token}`), `the part stylesheet does not read ${token}`);
	}
});

test('a dark palette sets color-scheme, so native controls are not left light', () => {
	// `color-scheme` drives scrollbars, form controls and the default canvas.
	// A dark page with light scrollbars is the most visible way a theme leaks.
	assert.match(scss, /color-scheme: var\(--rsm-th-scheme\);/);
	assert.doesNotMatch(scss, /^\tcolor-scheme: light;/m,
		'a hardcoded color-scheme cannot follow the palette');

	for (const palette of ['oled', 'gruvbox', 'nord']) {
		const block = new RegExp(`html\\.res-pageTheme--${palette} \\{([\\s\\S]*?)\\n\\}`).exec(scss);
		assert.match(block[1], /--rsm-th-scheme: dark;/, `${palette} must declare itself dark`);
	}
	const classic = /html\.res-pageTheme--classic \{([\s\S]*?)\n\}/.exec(scss);
	assert.match(classic[1], /--rsm-th-scheme: light;/);
});
