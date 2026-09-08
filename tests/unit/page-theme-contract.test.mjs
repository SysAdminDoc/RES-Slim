import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// Loaded through the shared helper rather than a hand-rolled strip-and-import:
// the helper resolves the sibling imports `lib/utils/pageTheme.js` now has, and a
// second copy of that logic is a second thing to fix every time one grows.
const { PAGE_THEME_IDS, normalizeTheme, desiredThemeClasses, forcedColorsActive, sanitizeAccent } =
	await loadFlowModule('lib/utils/pageTheme.js', 'page-theme', { deps: ['lib/utils/usernameColors.js'] });

test('normalizeTheme falls back to Classic Reddit for unknown values', () => {
	assert.equal(normalizeTheme('catppuccin'), 'catppuccin');
	assert.equal(normalizeTheme('does-not-exist'), 'classic');
	assert.equal(normalizeTheme(null), 'classic');
	for (const id of PAGE_THEME_IDS) assert.equal(normalizeTheme(id), id);
});

test('desiredThemeClasses always yields master + exactly one palette class', () => {
	const base = desiredThemeClasses({ theme: 'classic' });
	assert.deepEqual(base, ['res-pageTheme', 'res-pageTheme--classic']);
	const paletteClasses = base.filter(c => new RegExp(`^res-pageTheme--(${PAGE_THEME_IDS.join('|')})$`).test(c));
	assert.equal(paletteClasses.length, 1);
});

test('desiredThemeClasses appends only the enabled toggles', () => {
	const all = desiredThemeClasses({ theme: 'oled', declutter: true, refinedLayout: true, roundedCorners: true, collapseSidebar: true });
	assert.ok(all.includes('res-pageTheme--declutter'));
	assert.ok(all.includes('res-pageTheme--refined'));
	assert.ok(all.includes('res-pageTheme--rounded'));
	assert.ok(all.includes('res-pageTheme--collapse-sidebar'));

	const none = desiredThemeClasses({ theme: 'oled', declutter: false, refinedLayout: false, roundedCorners: false, collapseSidebar: false });
	assert.deepEqual(none, ['res-pageTheme', 'res-pageTheme--oled']);
});

test('sanitizeAccent accepts only hex colours', () => {
	assert.equal(sanitizeAccent('#8a5cff'), '#8a5cff');
	assert.equal(sanitizeAccent('#FFF'), '#FFF');
	assert.equal(sanitizeAccent('#12345678'), '#12345678');
	assert.equal(sanitizeAccent('red'), null);
	assert.equal(sanitizeAccent('#xyz'), null);
	assert.equal(sanitizeAccent('url(javascript:alert(1))'), null);
	assert.equal(sanitizeAccent(''), null);
});

test('pageTheme module is registered, enabled by default, and reversible', () => {
	const mod = read('lib/modules/pageTheme.js');
	assert.doesNotMatch(mod, /module\.disabledByDefault\s*=/);
	assert.match(mod, /theme:\s*\{[\s\S]*?value: 'classic'/);
	assert.match(mod, /refinedLayout:\s*\{[\s\S]*?value: true/);
	assert.match(mod, /roundedCorners:\s*\{[\s\S]*?value: false/);
	assert.match(mod, /if \(!Modules\.isRunning\(module\)\) \{\s*clearAll\(\);/);
	assert.match(mod, /localStorage\.getItem\(CACHE_KEY\)/); // anti-FOUC early apply
	// The accent is written from `accentRoles`, not raw, so a value that cannot
	// clear its contrast floor against the chosen palette is corrected on the way
	// out. `page-theme-accent-contract` owns that behaviour; this only pins that
	// the module still writes the property at all.
	assert.match(mod, /el\.style\.setProperty\('--rsm-th-accent', roles\.accent\)/);
	assert.match(mod, /module\.include = \['r2', 'd2x'\]/);

	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as pageTheme \} from '\.\/pageTheme';/);
	assert.match(index, /^\s*pageTheme,/m);
});

test('pageTheme stylesheet is wired into res.css with a palette per theme id', () => {
	const scss = read('lib/css/modules/_pageTheme.scss');
	for (const id of PAGE_THEME_IDS) {
		assert.match(scss, new RegExp(`html\\.res-pageTheme--${id}\\b`), `palette for ${id}`);
	}
	assert.match(scss, /--rsm-th-accent/);
	assert.match(scss, /html\.res-pageTheme--refined #header/);
	assert.match(scss, /html\.res-pageTheme--refined #siteTable > \.thing\.link/);
	assert.match(scss, /html\.res-pageTheme--refined \.commentarea > \.sitetable > \.comment/);
	assert.match(scss, /\.side > \.spacer:has\(> \.account-activity-box\)/);
	assert.match(scss, /\.side > \.spacer:has\(> \.sidebox\.create\)/);
	assert.match(scss, /html\.res-pageTheme--refined \.side #search input\[type=['"]submit['"]\]/);
	assert.match(scss, /html\.res-pageTheme--refined \.side #search::after/);
	assert.match(scss, /content: '\\F094'/);
	assert.match(scss, /\.side #search select\.rsm-search-dispatcher/);
	assert.match(scss, /\.side #searchexpando/);
	assert.match(scss, /\.commentarea \.comment > \.child/);
	assert.match(scss, /body\.comments-page > \.content > \.sitetable > \.thing\.link > \.thumbnail/);
	assert.match(scss, /\.commentarea > \.usertext textarea/);
	assert.match(scss, /\.commentarea \.dropdown \.selected/);
	assert.match(scss, /\.side \.fancy-toggle-button \.option\.active/);
	assert.match(scss, /\.sidecontentbox \.content/);
	assert.match(scss, /body\.combined-search-page \.searchpane\.raisedbox/);
	assert.match(scss, /body\.combined-search-page \.search-result-group/);
	assert.match(scss, /body\.combined-search-page \.search-result \.search-title/);
	assert.match(scss, /\.search-expando\.collapsed::before/);
	assert.match(scss, /body\.combined-search-page \.search-result-group footer \.info/);
	assert.match(scss, /:focus-visible/);
	assert.match(scss, /html\.res-pageTheme:has\(shreddit-app\)/);
	assert.match(scss, /shreddit-feed shreddit-post/);
	assert.match(scss, /shreddit-comment\[depth='0'\]/);
	assert.match(read('lib/css/res.scss'), /@use 'modules\/pageTheme';/);
});

test('the palette declares the colour scheme, and the layout toggle cannot take it away', () => {
	// Every root-level `color-scheme` here used to be gated on
	// `res-pageTheme--refined`, except the one gated on `shreddit-app`. Turn the
	// refined layout off on old Reddit and the palette still painted the body --
	// measured in headless Chromium on 2026-09-08, `res-pageTheme
	// res-pageTheme--gruvbox` gave a body of `rgb(40, 40, 40)` -- while the root
	// declared no scheme at all, so scrollbars, `<select>` popups and default
	// form-control chrome went back to light on a dark page.
	const scss = read('lib/css/modules/_pageTheme.scss');

	// Declared by the class every palette carries, reading the token every
	// palette defines.
	const palette = scss.slice(scss.indexOf('html.res-pageTheme {'), scss.indexOf('--rsm-th-bg-elev'));
	assert.match(palette, /color-scheme:\s*var\(--rsm-th-scheme\);/, 'the palette block has to declare the scheme');

	// And not by the layout toggle, in either direction. The literal `dark` that
	// used to sit under `html.res-pageTheme--refined` contradicted the token on
	// the light palette; it was harmless only while a higher-specificity rule
	// outranked it, which is not a property to rely on.
	const refined = scss.slice(scss.indexOf('html.res-pageTheme--refined {'));
	const refinedBlock = refined.slice(0, refined.indexOf('\n}'));
	assert.ok(!/^\tcolor-scheme:/m.test(refinedBlock), `the refined layout must not declare a scheme:\n${refinedBlock}`);

	// Every palette defines the token, or the declaration above resolves to
	// nothing for whichever one forgot.
	const missing = PAGE_THEME_IDS.filter(id => {
		const start = scss.indexOf(`html.res-pageTheme--${id} {`);
		if (start === -1) return false;
		return !/--rsm-th-scheme:\s*(light|dark);/.test(scss.slice(start, scss.indexOf('\n}', start)));
	});
	// Classic is the `:root`-level default and states `light` there; the rest
	// each state their own.
	assert.deepEqual(missing, [], `a palette defines no --rsm-th-scheme: ${missing.join(', ')}`);
});

test('the night-mode skin claims a colour scheme, gated the way its ink is', () => {
	// `color-scheme` is what the UA paints scrollbars, `<select>` popups, date
	// pickers, default form controls and the canvas behind an unstyled iframe
	// from. nightMode is on by default and is the whole of what a reader sees
	// with pageTheme off, and it declared none, so all of those stayed light on
	// its 15% grey page. Every other arm of the cascade declares one:
	// `_pageTheme.scss` per palette, `options.scss` per settings theme, and the
	// anti-FOUC guard for the moment before either exists.
	const night = read('lib/css/modules/_nightMode.scss');
	assert.match(night, /color-scheme:\s*dark;/, 'the night skin has to declare a scheme');

	// And gated on the same thing its ink is. `refinedLayout` decides which of
	// the two stylesheets paints the surface, so a scheme claimed unconditionally
	// would put dark UA chrome on the white page that Classic-plus-refined leaves
	// behind. The ink arm in `_tokens.scss` keys on exactly this.
	const rule = night.slice(0, night.indexOf('color-scheme: dark;'));
	const selector = rule.slice(rule.lastIndexOf('\n\n') + 2);
	assert.match(selector, /html:not\(\.res-pageTheme--refined\)\.res-nightmode/,
		`the root arm must stand down under the refined layout:\n  ${selector}`);
	assert.match(selector, /html:not\(\.res-pageTheme--refined\) body\.res-nightmode/,
		`the body arm must too, and both classes are written:\n  ${selector}`);

	// The palettes keep theirs, so the two files still disagree about nothing.
	assert.match(read('lib/css/modules/_pageTheme.scss'), /color-scheme:\s*var\(--rsm-th-scheme\);/);
});

// Windows High Contrast discards author colours, `box-shadow` and every non-URL
// `background-image`. The classic layout is built out of exactly those: the vote
// arrows are a `::before` whose entire visual is a background colour cut with a
// `clip-path`, the thumbnail placeholders are background images, and the row and
// panel edges are shadows. So the layer stands down there and reddit's own
// markup — SVGs drawn with `currentColor`, which survive the mode — shows
// through, rather than a half-erased imitation of old Reddit.
test('the refined layout stands down under forced colours, and only that class does', () => {
	const opts = { theme: 'oled', declutter: true, refinedLayout: true, roundedCorners: true, collapseSidebar: true };

	const normal = desiredThemeClasses({ ...opts, forcedColors: false });
	assert.ok(normal.includes('res-pageTheme--refined'));

	const forced = desiredThemeClasses({ ...opts, forcedColors: true });
	assert.ok(!forced.includes('res-pageTheme--refined'), 'the classic layout must not be gated on in forced colours');

	// Everything else is unchanged. The palette classes only set colours the UA is
	// already overriding, so dropping them would change nothing a reader sees in
	// the mode and would change what they see the moment they leave it.
	assert.deepEqual(forced, normal.filter(c => c !== 'res-pageTheme--refined'));
});

test('the forced-colours probe answers false rather than throwing where matchMedia is absent', () => {
	// It runs at `always`, which is re-entered on every option change, and in
	// contexts that have no `matchMedia` at all. Throwing there would take the
	// whole theme down with it.
	const saved = globalThis.matchMedia;
	try {
		delete globalThis.matchMedia;
		assert.equal(forcedColorsActive(), false);

		globalThis.matchMedia = () => { throw new Error('not supported'); };
		assert.equal(forcedColorsActive(), false);

		globalThis.matchMedia = query => ({ matches: query === '(forced-colors: active)' });
		assert.equal(forcedColorsActive(), true);
	} finally {
		if (saved === undefined) delete globalThis.matchMedia;
		else globalThis.matchMedia = saved;
	}
});
