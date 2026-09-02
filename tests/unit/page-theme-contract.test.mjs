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
const { PAGE_THEME_IDS, normalizeTheme, desiredThemeClasses, sanitizeAccent } =
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
