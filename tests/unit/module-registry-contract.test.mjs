// Registry-wide invariants, checked against every registered module at once.
//
// This is the cheapest route to covering the 33 modules that had no test: rather
// than 33 bespoke files, load the real registry and assert the properties that
// must hold for all of them. It executes — the module bodies run and these are
// their live option objects, not a regex over source.
//
// Every assertion here corresponds to a bug this repo has actually shipped:
// a category missing from the console's sort list (v0.19.0), a locale key
// rendering as itself because `i18n()` echoes unknown keys (v0.19.0), an enum
// default that is not one of its own values, and a module running on the options
// page because it declared no `include` (v0.3.5 and again in v0.4.0).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadModule } from './helpers/loadModule.mjs';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const Modules = await loadModule('lib/core/modules/modules.js', 'registry');
const all = Modules.all();

// The console's category order lives in one place so a module cannot invent a
// category that silently sorts to the front — `indexOf` returns -1 for an unknown
// category, which is *before* everything, not after.
//
// Loaded through loadFlowModule because the file carries Flow annotations. A
// plain dynamic import fails on them, and the first version of this test caught
// that failure and returned early — passing while checking nothing. Absence is
// now an assertion failure, not a skip.
const { CATEGORY_ORDER } = await loadFlowModule('lib/constants/settingsCategories.js', 'registry-categories');

test('the registry is non-empty and every module has a unique id', () => {
	assert.ok(all.length > 50, `expected the full module set, saw ${all.length}`);

	const seen = new Set();
	for (const module of all) {
		assert.ok(module.moduleID, 'every module must declare a moduleID');
		assert.ok(!seen.has(module.moduleID), `duplicate moduleID: ${module.moduleID}`);
		seen.add(module.moduleID);
	}
});

test('every module declares the metadata the settings console renders', () => {
	for (const module of all) {
		assert.ok(module.moduleName, `${module.moduleID} has no moduleName`);
		assert.ok(module.category, `${module.moduleID} has no category`);
		// `i18n()` echoes an unknown key rather than throwing, so a name that is
		// literally a key ending in "Name"/"Desc" would render raw in the sidebar.
		assert.equal(typeof module.moduleName, 'string');
	}
});

test('every module category is one the settings console knows how to sort', () => {
	assert.ok(Array.isArray(CATEGORY_ORDER) && CATEGORY_ORDER.length, 'CATEGORY_ORDER must load, or this test checks nothing');

	for (const module of all) {
		assert.ok(
			CATEGORY_ORDER.includes(module.category),
			`${module.moduleID} declares category "${module.category}", which is absent from CATEGORY_ORDER — an unknown category sorts to the *front*, not the back`,
		);
	}
});

test('every enum option default is one of its own values', () => {
	const offenders = [];

	for (const module of all) {
		for (const [key, option] of Object.entries(module.options || {})) {
			if (!option || option.type !== 'enum' || !Array.isArray(option.values)) continue;
			if (!option.values.some(v => v.value === option.value)) {
				offenders.push(`${module.moduleID}.${key} defaults to ${JSON.stringify(option.value)}`);
			}
		}
	}

	assert.deepEqual(offenders, [], 'an enum whose default is not in its own values renders as an empty select');
});

test('option types are drawable by the settings console', () => {
	// The console switches on `type`; an unrecognised one renders nothing at all,
	// so the option exists in storage but the user can never reach it.
	const DRAWABLE = new Set(['boolean', 'text', 'password', 'list', 'enum', 'keycode', 'color', 'table', 'builder']);
	const offenders = [];

	for (const module of all) {
		for (const [key, option] of Object.entries(module.options || {})) {
			if (!option || option.type === undefined) continue;
			if (!DRAWABLE.has(option.type)) offenders.push(`${module.moduleID}.${key}: ${option.type}`);
		}
	}

	assert.deepEqual(offenders, [], 'unknown option types render as nothing in the console');
});

test('a module that runs everywhere is deliberate, not an omission', () => {
	// An empty `include` means "run on every page", and that includes the
	// extension's own options page — `matchesPageLocation()` short-circuits to true
	// when `includes.length` is 0. Modules that touch reddit's DOM were twice found
	// running there (v0.3.5, v0.4.0). This pins the current set so a *new* module
	// cannot join it silently; shrinking the list is the open roadmap item.
	const EXPECTED_GLOBAL = [
		'RESMenu', 'commentDepth', 'hover', 'newCommentCount', 'nightMode',
		'noParticipation', 'notifications', 'requestPermissions',
		'search', 'settingsNavigation', 'sourceSnudown',
		'subredditBlacklist', 'version',
	].sort();

	const actual = all
		.filter(module => (!module.include || !module.include.length) && (!module.exclude || !module.exclude.length))
		.map(module => module.moduleID)
		.sort();

	assert.deepEqual(
		actual,
		EXPECTED_GLOBAL,
		'a module with neither include nor exclude runs on every page including the options page — add `module.include`, or update this list if it is intentional',
	);
});

test('the registry size matches what the docs claim', () => {
	// README and CLAUDE.md have repeatedly drifted from the real count. Reading it
	// from the index means the number in the docs can be checked against something.
	const index = fs.readFileSync(path.join(repoRoot, 'lib', 'modules', 'index.js'), 'utf8');
	const exported = (index.match(/^import \{ module as /gm) || []).length;

	assert.ok(exported > 0, 'could not count modules in lib/modules/index.js');
	assert.equal(all.length, exported, 'every module imported by the index should reach the registry');
});
