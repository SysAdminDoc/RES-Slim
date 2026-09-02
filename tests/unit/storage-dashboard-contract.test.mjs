import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

// The helper reaches the extension-origin database over the background bridge,
// so the bridge is the boundary to stand in for. Executing it is what makes the
// count and purge assertions below mean anything: the previous version of this
// file stripped types out of the source and only ever called `formatCount`.
const bridge = `
export const calls = [];
export const counts = { voteHistory: 3, mediaManifest: 0, savedContent: 7, subredditEmotes: 250 };
export function countRecords(store) { calls.push(['count', store]); return Promise.resolve(counts[store]); }
export function clearRecords(store) { calls.push(['clear', store]); counts[store] = 0; return Promise.resolve(1); }
`;

const load = () => loadFlowModule('lib/utils/storageDashboard.js', 'storage-dashboard', {
	deps: ['lib/utils/featureStores.js'],
	stubs: {
		'../environment/foreground/featureDb': bridge,
		'../environment': 'export const canPersistFeatureData = () => true;',
	},
});

test('formatCount renders count and cap percentage', async () => {
	const mod = await load();
	const result = mod.formatCount({ id: 'voteHistory', name: 'Test', count: 500, cap: 1000, available: true });
	assert.ok(result.includes('Test'));
	assert.ok(result.includes('500'));
	assert.ok(result.includes('1,000'));
	assert.ok(result.includes('50%'));
});

test('formatCount handles null cap', async () => {
	const mod = await load();
	const result = mod.formatCount({ id: 'savedContent', name: 'Test', count: 42, cap: null, available: true });
	assert.ok(result.includes('42'));
	assert.ok(!result.includes('%'));
});

test('every local data set is counted, and purging one clears that store alone', async () => {
	const mod = await load();
	const infos = await mod.getStoreInfos();
	assert.deepEqual(infos.map(info => info.id), ['voteHistory', 'mediaManifest', 'savedContent', 'subredditEmotes']);
	assert.deepEqual(infos.map(info => info.count), [3, 0, 7, 250]);
	// A set with no records still gets a row: "nothing here" is an answer, and
	// the dashboard is where you go to find out.
	assert.equal(infos.find(info => info.id === 'mediaManifest').name, 'Media history');

	await mod.clearStore(infos.find(info => info.id === 'voteHistory'));
	const after = await mod.getStoreInfos();
	assert.equal(after.find(info => info.id === 'voteHistory').count, 0);
	assert.equal(after.find(info => info.id === 'savedContent').count, 7);
});

test('a store that cannot be read reports zero rather than failing the whole dashboard', async () => {
	const mod = await loadFlowModule('lib/utils/storageDashboard.js', 'storage-dashboard-error', {
		deps: ['lib/utils/featureStores.js'],
		stubs: {
			'../environment': 'export const canPersistFeatureData = () => true;',
			'../environment/foreground/featureDb': `
				export function countRecords(store) {
					if (store === 'savedContent') return Promise.reject(new Error('store unavailable'));
					return Promise.resolve(1);
				}
				export function clearRecords() { return Promise.resolve(0); }
			`,
		},
	});
	const infos = await mod.getStoreInfos();
	assert.equal(infos.length, 4);
	assert.equal(infos.find(info => info.id === 'savedContent').count, 0);
});

test('the legacy database names stay recorded so an upgrade can still find the data', () => {
	const src = read('lib/utils/featureStores.js');
	assert.ok(src.includes('rsm-voteHistory'));
	assert.ok(src.includes('rsm-mediaManifest'));
	assert.ok(src.includes('rsm-savedContent'));
	assert.ok(src.includes('rsm-subredditEmotes'));
});

test('storageDashboard module is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.ok(index.includes("from './storageDashboard'"));
	assert.ok(index.includes('storageDashboard,'));
});

test('storageDashboard uses setTrustedHTML for DOM writes', () => {
	const src = read('lib/modules/storageDashboard.js');
	assert.ok(src.includes('setTrustedHTML'));
	assert.ok(src.includes("from '../core/dom/trustedHtml'"));
	assert.ok(src.includes("trigger.setAttribute('aria-expanded', 'false')"));
	assert.ok(src.includes("panel.setAttribute('role', 'region')"));
	assert.ok(src.includes("closeBtn.className = 'rsm-storageDashboard-close'"));
	assert.ok(src.includes('panel.replaceChildren(header, ...rows)'));
	assert.ok(!src.includes('panel.innerHTML ='));
});

test('storageDashboard has a SCSS module', () => {
	const scss = read('lib/css/modules/_storageDashboard.scss');
	assert.ok(scss.includes('.rsm-storageDashboard-panel'));
	assert.ok(scss.includes('.rsm-storageDashboard-header'));
	assert.ok(scss.includes('.rsm-storageDashboard-close'));
	assert.ok(scss.includes('.rsm-storageDashboard-purge'));
	assert.ok(scss.includes("[data-state='success']"));
	assert.ok(scss.includes('.rsm-storageDashboard-empty.is-error'));
});

test('storageDashboard SCSS is imported in res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.ok(res.includes("@use 'modules/storageDashboard'"));
});
