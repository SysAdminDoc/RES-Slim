import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const tmpDir = path.join(import.meta.dirname, '.tmp-engagement-bait');
fs.mkdirSync(tmpDir, { recursive: true });

const helperSrc = read('lib/utils/engagementBait.js');
const helperPath = path.join(tmpDir, 'engagementBait.mjs');
fs.writeFileSync(helperPath, helperSrc
	.replace(/\/\* @flow \*\//, '')
	.replace(/export type \w+[^;]+;/g, '')
	.replace(/: BaitSignal\[\]/g, '')
	.replace(/: \?BaitSignal/g, '')
	.replace(/: string/g, '')
);

const modUrl = pathToFileURL(helperPath).href;

test('DEFAULT_PATTERNS contains at least 8 patterns', async () => {
	const mod = await import(modUrl);
	assert.ok(mod.DEFAULT_PATTERNS.length >= 8);
});

test('matchTitle detects AITA prefix', async () => {
	const mod = await import(modUrl);
	const hit = mod.matchTitle('AITA for not going to my sister wedding', mod.DEFAULT_PATTERNS);
	assert.ok(hit);
	assert.equal(hit.label, 'AITA');
});

test('matchTitle detects ALL CAPS titles', async () => {
	const mod = await import(modUrl);
	const hit = mod.matchTitle('THIS IS ABSOLUTELY OUTRAGEOUS AND NOBODY CARES', mod.DEFAULT_PATTERNS);
	assert.ok(hit);
	assert.equal(hit.label, 'ALL CAPS');
});

test('matchTitle returns null for normal titles', async () => {
	const mod = await import(modUrl);
	const hit = mod.matchTitle('New study finds dark matter may interact with photons', mod.DEFAULT_PATTERNS);
	assert.equal(hit, null);
});

test('parsePatterns handles valid JSON array', async () => {
	const mod = await import(modUrl);
	const parsed = mod.parsePatterns('[{"pattern":"^TEST","label":"test"}]');
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].label, 'test');
});

test('parsePatterns returns empty for invalid input', async () => {
	const mod = await import(modUrl);
	assert.deepEqual(mod.parsePatterns('not json'), []);
	assert.deepEqual(mod.parsePatterns(''), []);
});

test('mergePatterns deduplicates by pattern string', async () => {
	const mod = await import(modUrl);
	const a = [{ pattern: '^A', label: 'custom' }];
	const b = [{ pattern: '^A', label: 'default' }, { pattern: '^B', label: 'other' }];
	const merged = mod.mergePatterns(b, a);
	assert.equal(merged.length, 2);
	assert.equal(merged[0].label, 'custom');
});

test('engagementBaitFilter module is registered and disabled by default', () => {
	const src = read('lib/modules/engagementBaitFilter.js');
	assert.ok(src.includes('disabledByDefault = true'));
	const index = read('lib/modules/index.js');
	assert.ok(index.includes("from './engagementBaitFilter'"));
	assert.ok(index.includes('engagementBaitFilter,'));
});
