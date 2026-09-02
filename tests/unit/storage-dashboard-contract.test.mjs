// The storage dashboard used to be a panel injected into old Reddit: a row per
// store, a count, and a purge button. All of that is the settings console's
// data workspace now, which can also search and export and does not need a
// Reddit page — so the module is the link to it, and these assertions follow
// the behaviour to where it went rather than describing a panel that is gone.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('the userbar links carry the workspace route as their href', () => {
	// `settingsNavigation` intercepts every settings link on the page, so the
	// href is the whole mechanism - and it is what makes a ctrl-click open the
	// console in a tab, which a click handler of our own would have swallowed.
	for (const file of [
		'lib/modules/storageDashboard.js',
		'lib/modules/voteHistory.js',
		'lib/modules/mediaArchiveManifest.js',
	]) {
		const src = read(file);
		assert.match(src, /href = makeUrlHash\(DATA_WORKSPACE_ROUTE\)/, `${file} should link to the workspace`);
		assert.doesNotMatch(src, /(?:a|trigger)\.addEventListener\('click'/, `${file} should leave the link to settingsNavigation`);
	}

	const dashboard = read('lib/modules/storageDashboard.js');
	assert.doesNotMatch(dashboard, /rsm-storageDashboard-panel/, 'the panel is the workspace now');
	assert.doesNotMatch(dashboard, /clearStore|getStoreInfos/, 'purging belongs to one implementation');
	// Still a 24px target: the userbar text is 15px tall.
	assert.match(dashboard, /rsm-target-24/);

	for (const file of ['lib/modules/voteHistory.js', 'lib/modules/mediaArchiveManifest.js']) {
		assert.doesNotMatch(read(file), /exporting…/, `${file} should not export straight from the page`);
	}
});

test('storageDashboard module is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.ok(index.includes("from './storageDashboard'"));
	assert.ok(index.includes('storageDashboard,'));
});

test('the workspace covers every set the dashboard used to list', async () => {
	const workspace = read('lib/options/dataWorkspace.js');
	for (const id of ['savedContent', 'userTags', 'voteHistory', 'mediaManifest', 'subredditEmotes']) {
		assert.match(workspace, new RegExp(`id: '${id}'`), `${id} has no workspace adapter`);
	}

	// Every adapter names a registered private-context policy, because the
	// database is the extension's and a private window shares it with the normal
	// profile.
	const policies = await loadFlowModule('lib/environment/foreground/privateBrowsing.js', 'workspace-policies');
	const declared = [...workspace.matchAll(/featureId: '([^']+)'/g)].map(match => match[1]);
	assert.equal(declared.length, 5);
	for (const id of declared) {
		assert.ok(Object.hasOwn(policies.FEATURE_DATA_STORE_POLICIES, id), `${id} has no registered policy`);
	}
	assert.match(workspace, /if \(!canPersistFeatureData\(\(set\.featureId: any\)\)\)/);
});

test('the legacy database names stay recorded so an upgrade can still find the data', () => {
	const src = read('lib/utils/featureStores.js');
	assert.ok(src.includes('rsm-voteHistory'));
	assert.ok(src.includes('rsm-mediaManifest'));
	assert.ok(src.includes('rsm-savedContent'));
	assert.ok(src.includes('rsm-subredditEmotes'));
});
