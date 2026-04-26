import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('settings saves await persistence before showing saved state', () => {
	const stage = read('lib/core/options/stage.js');
	const consoleSource = read('lib/options/settingsConsole.js');
	const locale = JSON.parse(read('locales/locales/en.json'));

	assert.match(stage, /async function commitStagedOptions\(\)/);
	assert.match(stage, /const previousOptionValues = \[\]/);
	assert.match(stage, /await Promise\.all\(savedOptions\)/);
	assert.match(stage, /await Promise\.all\(Object\.entries\(stagedModules\)/);
	assert.match(stage, /previousOptionValues\.reverse\(\)/);
	assert.match(consoleSource, /let isSavingOptions = false/);
	assert.match(consoleSource, /async function saveAllStagedOptions\(\)/);
	assert.match(consoleSource, /await Options\.stage\.commit\(\)/);
	assert.match(consoleSource, /if \(isSavingOptions\) return/);
	assert.equal(locale.settingsConsoleSaving.message, 'Saving...');
});
