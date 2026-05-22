import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const modSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/redgifsLayoutFix.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');

test('redgifsLayoutFix is registered in the aggregator', () => {
	assert.match(indexSource, /import \{ module as redgifsLayoutFix \} from '\.\/redgifsLayoutFix';/);
	assert.match(indexSource, /^\s*redgifsLayoutFix,/m);
});

test('redgifsLayoutFix targets the documented iframe selectors', () => {
	assert.match(modSource, /iframe\[src\*="redgifs\.com\/ifr\/"\]/);
	assert.match(modSource, /iframe\[src\*="redgifs\.com\/v\/"\]/);
	assert.match(modSource, /iframe\[src\*="redgifs\.com\/embed\/"\]/);
});

test('redgifsLayoutFix exposes enabled / maxHeight / hideRelated options', () => {
	for (const opt of ['enabled', 'maxHeight', 'hideRelated']) {
		assert.ok(modSource.includes(opt), `expected option ${opt}`);
	}
	for (const v of ['400', '500', '600', '720', '0']) {
		assert.ok(modSource.includes(`value: '${v}'`), `expected maxHeight value ${v}`);
	}
});

test('redgifsLayoutFix rewrites query params to suppress related overlay', () => {
	assert.match(modSource, /searchParams\.set\('related', '0'\)/);
	assert.match(modSource, /searchParams\.set\('controls', '1'\)/);
});

test('redgifsLayoutFix is disabled by default and has the rsm- body class', () => {
	assert.match(modSource, /module\.disabledByDefault = true;/);
	assert.match(modSource, /BODY_CLASS = 'rsm-redgifsLayoutFix'/);
});

test('redgifsLayoutFix ships beforeLoad + contentStart with style id', () => {
	assert.match(modSource, /module\.beforeLoad = \(\) =>/);
	assert.match(modSource, /module\.contentStart = \(\) =>/);
	assert.match(modSource, /STYLE_ID = 'RSMRedGifsLayoutFixStyle'/);
});
