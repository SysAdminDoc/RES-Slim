import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('continueThreadInline is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as continueThreadInline \} from '\.\/continueThreadInline';/);
	assert.match(index, /^\s*continueThreadInline,/m);
});

test('continueThreadInline only fires on comments pages', () => {
	const source = read('lib/modules/continueThreadInline.js');
	assert.match(source, /module\.include\s*=\s*\['comments'\]/);
});

test('continueThreadInline honours user-modifier keys so middle/ctrl-click still opens a new tab', () => {
	const source = read('lib/modules/continueThreadInline.js');
	assert.match(source, /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/);
	assert.match(source, /\(e: any\)\.button === 1/);
});

test('continueThreadInline fetches the destination page and splices the .nestedlisting subtree', () => {
	const source = read('lib/modules/continueThreadInline.js');
	assert.match(source, /fetch\(a\.href/);
	assert.match(source, /credentials: 'include'/);
	assert.match(source, /'\.commentarea \.sitetable\.nestedlisting'/);
	assert.match(source, /DOMParser/);
});

test('continueThreadInline matches both English "continue" prose and the .deepthread wrapper', () => {
	const source = read('lib/modules/continueThreadInline.js');
	assert.match(source, /text\.startsWith\('continue'\)/);
	assert.match(source, /\.closest\('\.deepthread, \.nestedlisting > \.morechildren'\)/);
});

test('continueThreadInline marks an anchor as processed before it can be double-clicked', () => {
	const source = read('lib/modules/continueThreadInline.js');
	assert.match(source, /PROCESSED_ATTR\s*=\s*'rsmContinueInlined'/);
	assert.match(source, /dataset\[PROCESSED_ATTR\] === 'true'/);
});
