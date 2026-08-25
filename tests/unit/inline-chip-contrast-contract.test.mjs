import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// The in-page chips RES-Slim injects into reddit's own markup sit on whatever
// background the page has: white by default, dark under nightMode/pageTheme.
// They were all authored against a dark page, so on a default install the
// author badge, per-sub sort button, auto-refresh status and restored-comment
// body rendered pale-on-pale — several under 2:1, i.e. invisible.
//
// This computes the same composited contrast a browser would, for both grounds,
// straight from the token values.

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const tokens = fs.readFileSync(path.join(repoRoot, 'lib/css/_tokens.scss'), 'utf8');

const TEXT_AA = 4.5;

function hex(value) {
	const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
	assert.ok(m, `expected a 6-digit hex colour, got ${value}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function channel(c) {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a, b) {
	const [l1, l2] = [luminance(a), luminance(b)];
	return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// color-mix(in srgb, X n%, transparent) over a base is X composited at n% alpha.
const mixOver = (colour, percent, base) => colour.map((c, i) => (c * percent) / 100 + base[i] * (1 - percent / 100));

// Read a token out of a specific selector block.
function readToken(block, name) {
	const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
	assert.ok(m, `token ${name} missing`);
	return m[1].trim();
}

function blockFor(selector) {
	const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(tokens);
	assert.ok(m, `could not find the ${selector} block in _tokens.scss`);
	return m[1];
}

const rootBlock = blockFor(':root');
// The dark block's selector now excludes the light palettes by name, because a
// bare `html.res-pageTheme` also matched Classic Reddit's white page. This file
// only needs the block's *values*, so it matches up to the brace rather than
// restating the exclusion list - `page-theme-ink-contract` is what checks that
// the list is right, derived from `--rsm-th-scheme` rather than hardcoded.
const darkBlock = blockFor("body\\.res-nightmode,\\s*\\nhtml\\.res-pageTheme[^{]*");

const GROUNDS = [
	// A default old.reddit page is white; the ink tokens in :root serve it.
	{ name: 'light page', block: rootBlock, background: [255, 255, 255] },
	// nightMode/pageTheme redefine the same tokens; --rsm-surface is the darkest
	// ground a chip realistically lands on.
	{ name: 'dark page', block: darkBlock, background: hex(readToken(rootBlock, '--rsm-surface')) },
];

const STATUS_INKS = ['--rsm-ink-success', '--rsm-ink-warning', '--rsm-ink-danger', '--rsm-ink-info'];

for (const ground of GROUNDS) {
	test(`status inks stay AA-legible on their own tinted fill (${ground.name})`, () => {
		const tint = Number(readToken(ground.block, '--rsm-tint').replace('%', ''));
		for (const name of STATUS_INKS) {
			const ink = hex(readToken(ground.block, name));
			// The label sits on the tint, not on the bare page — checking against
			// the page alone is what let the mature-account badge ship at 3.8:1.
			const fill = mixOver(ink, tint, ground.background);
			const ratio = contrast(ink, fill);
			assert.ok(ratio >= TEXT_AA,
				`${ground.name}: ${name} on its ${tint}% fill = ${ratio.toFixed(2)}:1 (needs >= ${TEXT_AA})`);
		}
	});

	test(`chip text stays AA-legible on the chip fill (${ground.name})`, () => {
		for (const name of ['--rsm-ink', '--rsm-ink-muted']) {
			const ink = hex(readToken(ground.block, name));
			const ratio = contrast(ink, ground.background);
			assert.ok(ratio >= TEXT_AA,
				`${ground.name}: ${name} on the page = ${ratio.toFixed(2)}:1 (needs >= ${TEXT_AA})`);
		}
	});
}

test('both grounds define the full ink set, so neither falls back to the other', () => {
	const required = ['--rsm-ink', '--rsm-ink-muted', '--rsm-chip-fill', '--rsm-chip-line', '--rsm-tint', ...STATUS_INKS];
	for (const ground of GROUNDS) {
		for (const name of required) {
			assert.match(ground.block, new RegExp(`${name}:`),
				`${ground.name} must define ${name}`);
		}
	}
});

test('inline surfaces reference ink tokens rather than the overlay text tokens', () => {
	// --rsm-text-* are for panels that paint their own dark background. An inline
	// chip using them is the exact bug this suite exists to catch.
	const inlineSurfaces = [
		'_authorContextBadge.scss', '_botCollapse.scss', '_perSubSort.scss',
		'_autoRefreshComments.scss', '_engagementBaitFilter.scss', '_filterRules.scss',
		'_repostDedupe.scss', '_removePromoted.scss', '_localCompanion.scss',
		'_arcticShift.scss', '_editedCommentDiff.scss', '_searchDispatcher.scss',
	];
	for (const file of inlineSurfaces) {
		const css = fs.readFileSync(path.join(repoRoot, 'lib/css/modules', file), 'utf8');
		assert.doesNotMatch(css, /var\(--rsm-text(-strong|-muted|-soft)?\)/,
			`${file} is an inline surface and must use --rsm-ink-* so it survives a light page`);
	}
});
