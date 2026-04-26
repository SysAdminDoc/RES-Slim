import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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
