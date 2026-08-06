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

test('focusable controls on the prompt have a visible focus ring', () => {
	assert.match(scss, /#request:focus-visible,[\s\S]{0,80}summary:focus-visible,[\s\S]{0,80}a:focus-visible/);
	assert.match(scss, /--prompt-focus-ring: 0 0 0 3px color-mix\(in srgb, var\(--prompt-accent\)/,
		'the ring must follow the accent rather than being a fixed hue');
});
