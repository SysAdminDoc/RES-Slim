// One authoritative supported-browser floor.
//
// It used to be declared twice and the two disagreed: `build.js` hardcoded
// chrome 114 / firefox 115, while `package.json`'s `browserslist` said chrome 114
// / firefox 119 and nothing read it. Only the build.js copy reached esbuild's
// `target` and the Firefox manifest's `strict_min_version`, so the package.json
// numbers were decoration — and any support claim resting on them was unverified.
//
// One consequence had already shipped: `roleHighlights` injects a `:has()` rule
// as a runtime CSS string, invisible to esbuild, and `:has()` did not land in
// Firefox until 121 — inside the advertised range, so it was a silent no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { codeOnly } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

// Minimum versions for the CSS features this codebase uses outside esbuild's
// sight — runtime-injected CSS strings, which no bundler can check.
const FEATURE_FLOORS = {
	':has()': { chrome: 105, firefox: 121 },
	'popover': { chrome: 114, firefox: 125 },
	'@starting-style': { chrome: 117, firefox: 129 },
	'transition-behavior': { chrome: 117, firefox: 129 },
};

function floors() {
	const parsed = {};
	for (const entry of pkg.browserslist) {
		const [name, version] = String(entry).trim().split(/\s+/);
		parsed[name] = Number.parseInt(version, 10);
	}
	return parsed;
}

test('browserslist declares a floor for both shipped targets', () => {
	const parsed = floors();

	assert.ok(Number.isInteger(parsed.chrome), 'browserslist must name a chrome floor');
	assert.ok(Number.isInteger(parsed.firefox), 'browserslist must name a firefox floor');
});

test('build.js derives its floor from browserslist rather than hardcoding one', () => {
	const source = codeOnly(read('build.js'));

	assert.ok(source.includes('browserMinVersions'), 'build.js should read the floor from package.json');
	// The specific numbers must not reappear as literals — that is exactly how the
	// two copies drifted apart in the first place.
	assert.ok(
		!/browserMinVersion:\s*'\d+\.\d+'/.test(source),
		'build.js must not hardcode a browserMinVersion literal',
	);
});

test('the Firefox manifest takes its strict_min_version from the same source', () => {
	// The template carries a token; the build substitutes it. A hardcoded version
	// here would be a third, independent copy of the floor.
	const manifest = read('firefox/manifest.json');

	assert.match(manifest, /"strict_min_version":\s*"__browser_min_version__"/);
});

test('the floor supports every CSS feature used in a runtime-injected stylesheet', () => {
	const parsed = floors();

	// `:has()` is the one already in use — roleHighlights builds it as a string, so
	// esbuild never sees it and cannot warn.
	const roleHighlights = codeOnly(read('lib/modules/roleHighlights.js'));
	assert.ok(roleHighlights.includes(':has('), 'sanity: roleHighlights should still inject a :has() rule');

	for (const [feature, required] of Object.entries(FEATURE_FLOORS)) {
		for (const browser of ['chrome', 'firefox']) {
			assert.ok(
				parsed[browser] >= required[browser],
				`${feature} needs ${browser} ${required[browser]}, but the declared floor is ${browser} ${parsed[browser]} — a rule using it would silently do nothing on supported browsers`,
			);
		}
	}
});
