import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(import.meta.dirname, '.tmp-storage-dashboard');
fs.mkdirSync(tmpDir, { recursive: true });

const helperSrc = read('lib/utils/storageDashboard.js');
const stripped = helperSrc
	.replace(/\/\* @flow \*\//, '')
	.replace(/export type \w+ = \{\|[\s\S]*?\|\};/g, '')
	.replace(/: StoreInfo\[\]/g, '')
	.replace(/: StoreInfo/g, '')
	.replace(/: string/g, '')
	.replace(/: number/g, '')
	.replace(/: \?number/g, '')
	.replace(/: Array<\{\|[^|]+\|\}>/g, '')
	.replace(/: Promise<StoreInfo\[\]>/g, '')
	.replace(/: Promise<void>/g, '')
	.replace(/: Promise<number>/g, '');
const helperPath = path.join(tmpDir, 'storageDashboard.mjs');
fs.writeFileSync(helperPath, stripped);
const modUrl = pathToFileURL(helperPath).href;

test('formatCount renders count and cap percentage', async () => {
	const mod = await import(modUrl);
	const result = mod.formatCount({ name: 'Test', dbName: 'db', storeName: 's', schemaVersion: 1, count: 500, cap: 1000 });
	assert.ok(result.includes('Test'));
	assert.ok(result.includes('500'));
	assert.ok(result.includes('1,000'));
	assert.ok(result.includes('50%'));
});

test('formatCount handles null cap', async () => {
	const mod = await import(modUrl);
	const result = mod.formatCount({ name: 'Test', dbName: 'db', storeName: 's', schemaVersion: 1, count: 42, cap: null });
	assert.ok(result.includes('42'));
	assert.ok(!result.includes('%'));
});

test('KNOWN_STORES includes voteHistory and mediaManifest', async () => {
	const src = read('lib/utils/storageDashboard.js');
	assert.ok(src.includes('rsm-voteHistory'));
	assert.ok(src.includes('rsm-mediaManifest'));
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
	assert.ok(res.includes("@import 'modules/storageDashboard'"));
});
