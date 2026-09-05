// The two shipped manifests come from one source, and the differences between
// them are declared.
//
// They were maintained by hand. That worked while the differences were small and
// remembered, and this repo has already paid for the case where they were not:
// `firefox/beta/manifest.json` accumulated permissions the shipped manifests
// never had plus an unsubstituted `__browser_mobile_min_version__` token, and
// was deleted rather than repaired.
//
// Two things are under test. That what is committed still equals what
// `manifest.config.js` produces, so the files cannot be edited in place and
// quietly diverge from their source. And that each MV2/MV3 difference is one the
// config names — because a transform nobody wrote down is indistinguishable from
// drift when you find it a year later.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { TARGETS, TRANSFORMS, manifestFor, serializeManifest } from '../../manifest.config.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const committed = Object.fromEntries(TARGETS.map(target => [target, JSON.parse(read(`${target}/manifest.json`))]));

test('what is committed is what the generator produces', () => {
	// The whole point. `yarn manifest` after any change to the config; this is
	// what says you forgot.
	for (const target of TARGETS) {
		assert.equal(
			read(`${target}/manifest.json`),
			serializeManifest(target),
			`${target}/manifest.json has drifted from manifest.config.js — run \`yarn manifest\``,
		);
	}
});

test('both targets are generated, or this file is measuring one manifest', () => {
	assert.deepEqual([...TARGETS].sort(), ['chrome', 'firefox']);
	assert.throws(() => manifestFor('safari'), /Unknown manifest target/);
});

test('every key that differs between the targets is a declared transform', () => {
	const declared = new Set(TRANSFORMS.flatMap(entry => entry.keys));
	const chrome = manifestFor('chrome');
	const firefox = manifestFor('firefox');

	const keys = new Set([...Object.keys(chrome), ...Object.keys(firefox)]);
	const undeclared = [...keys].filter(key => (
		JSON.stringify(chrome[key]) !== JSON.stringify(firefox[key]) && !declared.has(key)
	));

	assert.deepEqual(
		undeclared,
		[],
		`These keys differ between the two manifests with no entry in TRANSFORMS saying why:\n  ${undeclared.join('\n  ')}`,
	);
});

test('a declared transform still describes a real difference', () => {
	// The reverse direction. An entry left behind after the difference it
	// explained went away reads as considered thought about something that is no
	// longer true.
	const chrome = manifestFor('chrome');
	const firefox = manifestFor('firefox');

	for (const entry of TRANSFORMS) {
		for (const key of entry.keys) {
			assert.notEqual(
				JSON.stringify(chrome[key]),
				JSON.stringify(firefox[key]),
				`TRANSFORMS names "${key}", which is now identical across both targets. Delete it from the entry. Its reason was: ${entry.reason}`,
			);
		}
		assert.ok(entry.keys.length > 0, 'a transform has to name at least one key');
		assert.ok(entry.reason.length > 40, `"${entry.keys.join('/')}" needs a reason, not a label`);
	}
});

test('everything not named as a transform is byte-identical across the targets', () => {
	// The value of one source is this line. Matches, exclusions, the DNR ruleset
	// and the content-script wiring are one list read twice, so the class of bug
	// where a host is added to one target only cannot be written.
	const declared = new Set(TRANSFORMS.flatMap(entry => entry.keys));
	const chrome = manifestFor('chrome');
	const firefox = manifestFor('firefox');

	for (const key of Object.keys(chrome)) {
		if (declared.has(key)) continue;
		if (!Object.hasOwn(firefox, key)) continue;
		assert.deepEqual(chrome[key], firefox[key], `${key} should be shared`);
	}

	assert.deepEqual(chrome.content_scripts, firefox.content_scripts, 'the content script is the surface both targets have to agree on');
});

test('the browser floor is still a token in both, not a literal', () => {
	// `browser-targets-contract` asserts this against the files. Asserted here
	// too because the generator is now the thing that could hardcode it, and a
	// generator that substitutes a version would defeat the single-floor rule
	// while leaving both files looking correct.
	assert.equal(committed.chrome.minimum_chrome_version, '__browser_min_version__');
	assert.equal(committed.firefox.browser_specific_settings.gecko.strict_min_version, '__browser_min_version__');
	for (const target of TARGETS) {
		const raw = read(`${target}/manifest.json`);
		for (const token of ['__name__', '__version__', '__description__', '__author__', '__homepage__']) {
			assert.ok(raw.includes(token), `${target}/manifest.json lost ${token}`);
		}
	}
});

test('the MV2 and MV3 shapes are each actually correct for their target', () => {
	// A generator makes it cheap to produce two files and easy to produce two
	// wrong ones. These are the shape rules each store enforces at submission.
	assert.equal(committed.chrome.manifest_version, 3);
	assert.ok(committed.chrome.background.service_worker, 'MV3 has no background scripts array');
	assert.equal(committed.chrome.background.scripts, undefined);
	assert.equal(typeof committed.chrome.content_security_policy, 'object');
	assert.match(committed.chrome.content_security_policy.extension_pages, /script-src 'self'/);
	assert.ok(Array.isArray(committed.chrome.host_permissions), 'MV3 keeps host permissions separate');
	assert.ok(committed.chrome.web_accessible_resources.every(entry => Array.isArray(entry.resources) && Array.isArray(entry.matches)),
		'MV3 web-accessible resources are scoped to the origins allowed to load them');

	assert.equal(committed.firefox.manifest_version, 2);
	assert.ok(Array.isArray(committed.firefox.background.scripts), 'MV2 has no service worker');
	assert.equal(committed.firefox.background.service_worker, undefined);
	assert.equal(typeof committed.firefox.content_security_policy, 'string');
	assert.equal(committed.firefox.host_permissions, undefined, 'MV2 folds host permissions into permissions');
	assert.ok(committed.firefox.permissions.includes('https://*.reddit.com/*'), 'and the reddit match has to be in there');
	assert.ok(committed.firefox.web_accessible_resources.every(entry => typeof entry === 'string'), 'MV2 takes bare paths');
	// MV3 uses `action`; MV2 Firefox still wants `page_action`.
	assert.ok(committed.chrome.action && !committed.chrome.page_action);
	assert.ok(committed.firefox.page_action && !committed.firefox.action);
});

test('the page-world scripts stay web accessible on both, whatever shape the key takes', () => {
	// The delivery fix for `eventTrackingSabotage` depends on this file being
	// loadable by URL from a reddit page, and it is listed in two different
	// shapes. Losing it on one target would make the module silently inert there
	// again, which is exactly the failure it took a browser to find the first
	// time.
	//
	// Every page-world entry, not just the first one. `shredditReveal.entry.js`
	// arrived later and this test was not widened with it, so for a while the
	// NSFW reveal could have been dropped from either manifest with nothing
	// failing — the same regression this test exists to prevent, one file over.
	// Derived from the directory rather than listed, so the next one is covered
	// on the day it is written.
	const pageWorld = fs.readdirSync(path.join(repoRoot, 'lib', 'pageWorld'))
		.filter(name => name.endsWith('.entry.js'));
	assert.ok(pageWorld.length >= 2, `expected the page-world entries, found ${pageWorld.join(', ') || 'none'}`);

	for (const entry of pageWorld) {
		assert.ok(
			committed.chrome.web_accessible_resources[0].resources.includes(entry),
			`${entry} is not web accessible on chrome, so the page cannot load it`,
		);
		assert.ok(
			committed.firefox.web_accessible_resources.includes(entry),
			`${entry} is not web accessible on firefox, so the page cannot load it`,
		);
	}
});
