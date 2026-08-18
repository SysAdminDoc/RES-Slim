import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { codeOnly } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('release build validates targets and zips nested output paths', () => {
	const build = read('build.js');

	assert.match(build, /function normalizeBuildTargets\(browsers\)/);
	assert.match(build, /Unknown browser target/);
	assert.match(build, /No browser targets requested/);
	assert.match(build, /function addDirectoryToZip\(zip, sourceDir, currentDir = sourceDir\)/);
	assert.match(build, /withFileTypes: true/);
	assert.match(build, /path\.relative\(sourceDir, entryPath\)\.split\(path\.sep\)\.join\('\/'\)/);
});

test('public package metadata no longer ships placeholder URLs or stale badges', () => {
	const packageInfo = JSON.parse(read('package.json'));
	const readme = read('README.md');

	assert.equal(packageInfo.homepage, 'https://github.com/SysAdminDoc/RES-Slim');
	assert.match(readme, new RegExp(`version-${packageInfo.version.replaceAll('.', '\\.')}`));
	assert.match(readme, /license-GPL--3\.0/);
	assert.doesNotMatch(readme, /example\.invalid|license-MIT|version-v5\.24\.8/);
});

test('browser action icons are declared at their actual shipped sizes', () => {
	const chromeManifest = JSON.parse(read('chrome/manifest.json'));
	const firefoxManifest = JSON.parse(read('firefox/manifest.json'));
	const pageAction = read('lib/environment/background/pageAction.js');

	assert.deepEqual(chromeManifest.action.default_icon, {
		16: 'css-on-small.png',
		32: 'css-on.png',
	});
	assert.deepEqual(firefoxManifest.page_action.default_icon, {
		16: 'css-on-small.png',
		32: 'css-on.png',
	});
	assert.match(pageAction, /'16': state \? 'css-on-small\.png' : 'css-off-small\.png'/);
	assert.match(pageAction, /'32': state \? 'css-on\.png' : 'css-off\.png'/);
});

test('Firefox manifest does not advertise unsupported Android compatibility', () => {
	const firefoxManifest = JSON.parse(read('firefox/manifest.json'));

	assert.equal(firefoxManifest.browser_specific_settings.gecko_android, undefined);
});

test('the release build produces both browser targets', () => {
	// `--browsers` defaults to chrome alone, so the documented release command
	// used to emit a Chrome-only artifact while the release notes promised two.
	const packageInfo = JSON.parse(read('package.json'));
	assert.match(packageInfo.scripts.build, /--browsers chrome,firefox/);
});

test('production emits no sourcemaps for either target', () => {
	const build = read('build.js');
	// The old expression, `!isProduction || !noSourcemap`, is true for any target
	// that does not set noSourcemap — i.e. Chrome — so the Chrome zip shipped
	// .map files carrying every original source and came out at more than double
	// the Firefox one.
	assert.match(build, /sourcemap: !isProduction,/);
	assert.doesNotMatch(build, /sourcemap: !isProduction \|\| !noSourcemap/);
	// The per-target flag is gone rather than left as dead config that reads as
	// if it still controls something. Checked against comment-stripped source,
	// since the comment above deliberately names the old expression.
	assert.match(build, /noSourcemap/, 'the comment should still record what changed');
	assert.doesNotMatch(codeOnly(build), /noSourcemap/);
});

test('zipping happens after the gates, not as a plugin among them', () => {
	const build = read('build.js');
	// esbuild runs every onEnd callback and aggregates their errors, so a zip
	// plugin merely *registered* after the budget and integrity gates would still
	// write an artifact for a build that failed one. Zipping after
	// esbuild.build() resolves is the only ordering that cannot leave a
	// shippable zip behind for a rejected build.
	assert.doesNotMatch(build, /name: 'zip-build'/);
	assert.match(build, /const result = await esbuild\.build\(context\)/);
	const buildAt = build.indexOf('const result = await esbuild.build(context)');
	const zipAt = build.indexOf('if (options.zip) {');
	assert.ok(zipAt > buildAt, 'zipping must follow the awaited build');
});

test('the bundle gate covers the two largest shipped assets', () => {
	const build = read('build.js');
	// res.css is injected into every frame at document_start and was ungated, as
	// was the vendored dash player — together larger than every budgeted script.
	// Assert against the recorded baseline rather than the source, because the
	// baseline is the data the gate actually compares against: a file could be
	// listed in TRACKED and still never be measured if it were never recorded.
	const baseline = JSON.parse(read('tests/fixtures/lint/bundle-baseline.json'));
	const targets = Object.keys(baseline);

	assert.deepEqual(targets.sort(), ['chrome', 'firefox'], 'both shipped targets must be recorded');
	for (const target of targets) {
		for (const file of ['res.css', 'dash.mediaplayer.min.js', 'options.css', 'foreground.entry.js', 'options.entry.js', 'background.entry.js']) {
			assert.equal(
				typeof baseline[target][file],
				'number',
				`${target}/${file} has no recorded size, so nothing gates its growth`,
			);
		}
	}
	assert.match(build, /const TRACKED = \[/);
});

test('the bundle gate is a ratchet, not a ceiling', () => {
	const build = read('build.js');
	// The budgets this replaced sat ~400KB above reality, so a third of the
	// foreground entry could be added without tripping them. A ratchet has to
	// fail in both directions — a silent shrink is a win being lost, and is also
	// how a truncated or half-written bundle would slip through.
	assert.match(build, /grew|shrank/);
	assert.match(build, /Math\.abs\(delta\) <= TOLERANCE/);
	assert.doesNotMatch(build, /stat\.size > limit/, 'a one-sided size ceiling is what this replaced');
});

test('a budgeted file that is missing fails the build', () => {
	const build = read('build.js');
	// `.catch(() => null)` plus `continue` meant a renamed or never-built
	// entrypoint passed the gate silently — the exact case the gate exists for.
	assert.doesNotMatch(build, /if \(!stat\) continue;/);
	assert.match(build, /missing from the build output/);
});

test('the Firefox build has its own add-on ID', () => {
	// Shipping upstream RES's AMO ID makes the fork collide with an installed RES
	// on Firefox, so the two cannot be side-loaded together.
	for (const file of ['firefox/manifest.json']) {
		const manifest = JSON.parse(read(file));
		const { id } = manifest.browser_specific_settings.gecko;
		assert.notEqual(id, 'jid1-xUfzOsOFlzSOXg@jetpack', `${file} still ships upstream RES's add-on ID`);
		assert.equal(id, 'res-slim@sysadmindoc', file);
	}
});

test('both Firefox manifests declare that no data is collected', () => {
	// AMO has auto-rejected submissions without this key since 2025-11-03. A
	// no-telemetry extension is the trivial case, so its absence was pure
	// paperwork blocking any Firefox distribution.
	for (const file of ['firefox/manifest.json']) {
		const manifest = JSON.parse(read(file));
		assert.deepEqual(
			manifest.browser_specific_settings.gecko.data_collection_permissions,
			{ required: ['none'] },
			file,
		);
	}
});
