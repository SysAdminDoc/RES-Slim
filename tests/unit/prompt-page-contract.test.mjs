import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const html = read('lib/environment/background/permissions/prompt.html');
const scss = read('lib/environment/background/permissions/prompt.scss');
const entry = read('lib/environment/background/permissions/prompt.entry.js');
const buildScript = read('build.js');
const manifest = JSON.parse(read('chrome/manifest.json'));
const firefoxManifest = JSON.parse(read('firefox/manifest.json'));

test('the prompt page carries no inline style or script, which the manifest CSP forbids', () => {
	// Neither manifest declares style-src, so `default-src 'self'` governs styles
	// in both. An inline <style> block is therefore refused outright — the prompt
	// shipped as unstyled raw HTML until this was split into a stylesheet.
	// Chrome MV3 nests the policy under extension_pages; Firefox MV2 is a string.
	const chromeCsp = manifest.content_security_policy.extension_pages;
	const firefoxCsp = firefoxManifest.content_security_policy;

	for (const [name, csp] of [['chrome', chromeCsp], ['firefox', firefoxCsp]]) {
		assert.equal(typeof csp, 'string', `${name} manifest must declare a CSP`);
		assert.match(csp, /default-src 'self'/, `${name} CSP must keep default-src 'self'`);
		assert.doesNotMatch(csp, /style-src[^;]*unsafe-inline/,
			`${name}: the fix is a real stylesheet, not a loosened policy`);
	}

	assert.doesNotMatch(html, /<style[\s>]/, 'inline <style> is blocked by the extension CSP');
	assert.doesNotMatch(html, /\sstyle="/, 'inline style attributes are blocked by the same directive');
	assert.match(html, /<link rel="stylesheet" href="prompt\.css">/);
});

test('prompt.css is an actual build entry point, so the link resolves', () => {
	assert.match(buildScript, /prompt: '\.\/lib\/environment\/background\/permissions\/prompt\.scss'/);
	assert.ok(scss.includes('.permissionShell'), 'expected the shell styles to live in the stylesheet');
	assert.ok(scss.includes('#request'), 'expected the primary action styles to live in the stylesheet');
});

test('the prompt describes what it is asking for in words', () => {
	assert.match(entry, /PERMISSION_LABELS/);
	assert.match(entry, /describePermission\(/);
	assert.match(entry, /describeOrigin\(/);
	// The raw pattern stays reachable as a tooltip rather than being discarded.
	assert.match(entry, /listItem\.title = origin/);
});

test('the prompt does not point at upstream RES resources', () => {
	// This fork deliberately strips upstream RES branding and links.
	assert.doesNotMatch(html, /r\/Enhancement/);
	assert.doesNotMatch(html, /redditenhancementsuite/i);
});

test('the prompt adopts the accent of the theme chosen in the settings console', () => {
	const presets = read('lib/constants/settingsThemes.js');
	// One definition of the key and of each accent, read by both surfaces.
	assert.match(presets, /SETTINGS_THEME_STORAGE_KEY = 'res-settings-theme'/);
	assert.match(presets, /export function getSettingsThemeAccent/);

	assert.match(entry, /SETTINGS_THEME_STORAGE_KEY/);
	assert.match(entry, /getSettingsThemeAccent\(theme\)/);
	assert.match(entry, /setProperty\('--prompt-accent'/);
	// Storage can be unavailable; the CSS fallback has to survive that.
	assert.match(entry, /catch \(e\) \{[\s\S]{0,220}?return;/);

	// Every accent-derived value must follow --prompt-accent, or re-theming the
	// page would leave graphite blue behind in the eyebrow, links and focus ring.
	// The focus ring carries box-shadow offsets before its colour, so allow
	// anything between the token name and the color-mix() that supplies the hue.
	for (const token of ['--prompt-accent-soft', '--prompt-accent-strong', '--prompt-accent-line', '--prompt-focus-ring']) {
		assert.match(scss, new RegExp(`${token}:[^;]*color-mix\\(in srgb, var\\(--prompt-accent\\)`),
			`${token} must derive from --prompt-accent`);
	}

	// Each preset the console offers must supply an accent for the prompt to use.
	const ids = [...presets.matchAll(/\{ id: '([a-z]+)'[^}]*accent: '(#[0-9a-f]{6})'/g)].map(m => m[1]);
	assert.equal(ids.length, 9, `expected all 9 presets to declare an accent, got ${ids.length}`);
});

test('the prompt draws the RS monogram rather than the upstream alien bitmap', () => {
	// res.css ships `.res-logo { background-image: url(icon60x30.png) }` for the
	// content script. The prompt loads res.css but not options.css, so it picked
	// up the alien while the settings console drew a monogram.
	assert.match(scss, /\.permissionHeader \.res-logo::before \{[\s\S]{0,80}content: 'RS';/);
	assert.match(scss, /background-image: none/);
});

test('focusable controls on the prompt have a visible focus ring', () => {
	assert.match(scss, /#request:focus-visible,[\s\S]{0,80}summary:focus-visible,[\s\S]{0,80}a:focus-visible/);
	assert.match(scss, /--prompt-focus-ring: 0 0 0 3px color-mix\(in srgb, var\(--prompt-accent\)/,
		'the ring must follow the accent rather than being a fixed hue');
});
