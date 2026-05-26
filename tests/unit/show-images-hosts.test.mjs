import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const hostsDir = path.join(repoRoot, 'lib', 'modules', 'hosts');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const expectedHostCount = 88;
const criticalHosts = new Set([
	'defaultImage',
	'defaultAudio',
	'defaultVideo',
	'imgur',
	'ireddit',
	'redditgallery',
	'redditmedia',
	'redgifs',
	'streamable',
	'vreddit',
	'youtube',
]);

function hostFiles() {
	return fs.readdirSync(hostsDir)
		.filter(file => file.endsWith('.js') && file !== 'index.js')
		.map(file => file.replace(/\.js$/, ''))
		.sort();
}

function parseHostIndex() {
	const source = read('lib/modules/hosts/index.js');
	const imports = [...source.matchAll(/^import\s+([A-Za-z0-9_$]+)\s+from\s+'\.\/([^']+)';$/gm)]
		.map(([, binding, sourcePath]) => ({ binding, sourcePath }));
	const exportBlock = source.match(/export\s+\{([\s\S]*?)\n\}/);
	assert.ok(exportBlock, 'host index should have a named export block');
	const exports = exportBlock[1].split(',')
		.map(entry => entry.trim())
		.filter(Boolean)
		.sort();
	return { imports, exports };
}

function parseHostSource(moduleID) {
	return read(`lib/modules/hosts/${moduleID}.js`);
}

function parseDomains(moduleID) {
	const source = parseHostSource(moduleID);
	const match = source.match(/domains:\s*\[([\s\S]*?)\]/);
	assert.ok(match, `${moduleID} should declare domains`);
	return [...match[1].matchAll(/'([^']+)'/g)].map(([, domain]) => domain);
}

function hostnameMatchesDomain(hostname, domain) {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function manifestPermissions(manifestPath) {
	const manifest = JSON.parse(read(manifestPath));
	return new Set([
		...(manifest.permissions || []),
		...(manifest.optional_permissions || []),
		...(manifest.host_permissions || []),
		...(manifest.optional_host_permissions || []),
	].filter(value => value.startsWith('http')));
}

function parseHostPermissions(moduleID) {
	const source = parseHostSource(moduleID);
	const match = source.match(/permissions:\s*\[([\s\S]*?)\]/);
	if (!match) return [];
	return [...match[1].matchAll(/'([^']+)'/g)].map(([, permission]) => permission);
}

function fixtureLinks() {
	const html = read('tests/fixtures/showImages/old-reddit-media.html');
	return [...html.matchAll(/<a\b([^>]+)>/g)].map(([, attributes]) => {
		const getAttr = name => attributes.match(new RegExp(`${name}="([^"]+)"`))?.[1];
		return {
			href: getAttr('href'),
			expectedHost: getAttr('data-expected-host'),
			genericHost: attributes.includes('data-generic-host="true"'),
		};
	});
}

test('showImages host index imports and exports every host handler exactly once', () => {
	const files = hostFiles();
	const { imports, exports } = parseHostIndex();
	const importedBindings = imports.map(({ binding }) => binding).sort();
	const importedSources = imports.map(({ sourcePath }) => sourcePath).sort();

	assert.equal(files.length, expectedHostCount);
	assert.deepEqual(importedSources, files);
	assert.deepEqual(exports, importedBindings);

	for (const moduleID of criticalHosts) {
		assert.ok(exports.includes(moduleID), `${moduleID} should remain registered`);
	}
});

test('showImages fixture page links map to registered host domains', () => {
	for (const { href, expectedHost, genericHost } of fixtureLinks()) {
		assert.ok(href, 'fixture link should include href');
		assert.ok(expectedHost, `${href} should declare data-expected-host`);
		const domains = parseDomains(expectedHost);

		if (genericHost) {
			assert.deepEqual(domains, [], `${expectedHost} should be a generic fallback host`);
			continue;
		}

		const { hostname } = new URL(href);
		assert.ok(
			domains.some(domain => hostnameMatchesDomain(hostname, domain)),
			`${href} should be covered by ${expectedHost} domains: ${domains.join(', ')}`,
		);
	}
});

test('host optional permissions stay mirrored in both browser manifests', () => {
	const chromePermissions = manifestPermissions('chrome/manifest.json');
	const firefoxPermissions = manifestPermissions('firefox/manifest.json');

	for (const moduleID of hostFiles()) {
		for (const permission of parseHostPermissions(moduleID)) {
			assert.ok(chromePermissions.has(permission), `${moduleID} permission ${permission} missing from Chrome manifest`);
			assert.ok(firefoxPermissions.has(permission), `${moduleID} permission ${permission} missing from Firefox manifest`);
		}
	}
});

test('comment text media auto-expands image/gallery/muted media expandos by default', () => {
	const source = read('lib/modules/showImages.js');

	assert.match(source, /autoExpandCommentMedia:\s*\{[\s\S]*?value:\s*true/);
	assert.match(source, /title:\s*'showImagesAutoExpandCommentMediaTitle'/);
	assert.match(source, /module\.options\.autoExpandCommentMedia\.value && inText\(expando\.button\) && thing && thing\.isComment\(\)/);
	assert.match(source, /autoExpand = true;/);

	const locale = read('locales/locales/en.json');
	assert.match(locale, /showImagesAutoExpandCommentMediaTitle/);
	assert.match(locale, /Automatically expand images, galleries, and muted media/);
});
