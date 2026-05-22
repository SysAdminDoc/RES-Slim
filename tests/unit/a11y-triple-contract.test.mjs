import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/a11yTriple.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('a11yTriple is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as a11yTriple \} from '\.\/a11yTriple';/);
	assert.match(indexSource, /^\s*a11yTriple,/m);
});

test('a11yTriple ships the three documented options', () => {
	for (const opt of ['fontSize', 'readableFont', 'sidebarRail']) {
		assert.ok(modSource.includes(opt), `expected option ${opt}`);
	}
});

test('a11yTriple offers four size scales and four font presets + default', () => {
	for (const sz of ['100', '110', '125', '140']) {
		assert.ok(modSource.includes(`value: '${sz}'`), `expected size scale ${sz}`);
	}
	for (const font of ['OpenDyslexic', 'Atkinson Hyperlegible', 'Lexend']) {
		assert.ok(modSource.includes(font), `expected font preset ${font}`);
	}
});

test('a11yTriple is disabled by default and lives under appearanceCategory', () => {
	assert.match(modSource, /module\.disabledByDefault = true;/);
	assert.match(modSource, /module\.category = 'appearanceCategory';/);
});

test('sidebar rail rules use prefers-reduced-motion guard and rail body class', () => {
	assert.match(modSource, /prefers-reduced-motion: reduce/);
	assert.match(modSource, /RAIL_CLASS = 'rsm-a11yTriple-rail'/);
	assert.match(modSource, /body\.\$\{RAIL_CLASS\} \.side:hover/);
});

test('font-family swap requires explicit user selection (defaults to empty)', () => {
	// The first preset is the no-op default; the option default value mirrors it.
	const m = /readableFont:\s*\{[\s\S]*?value:\s*'(.*?)'/.exec(modSource);
	assert.ok(m, 'readableFont should declare a value');
	assert.equal(m[1], '', 'default value must be empty (off)');
});

test('a11yTriple ships both beforeLoad and contentStart hooks', () => {
	assert.match(modSource, /module\.beforeLoad = \(\) =>/);
	assert.match(modSource, /module\.contentStart = \(\) =>/);
	assert.match(modSource, /STYLE_ID = 'RSMA11yTripleStyle'/);
});
