import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('background permission prompt resolver cannot hang on malformed result URLs', () => {
	const source = read('lib/environment/background/permissions.js');

	assert.match(source, /const requestPermissions = apiToPromise/);
	assert.match(source, /const createWindow = apiToPromise/);
	assert.match(source, /if \(typeof id !== 'number'\) return false/);
	assert.match(source, /function finish\(result, closeTab = false\)/);
	assert.match(source, /JSON\.parse\(updatedUrl\.searchParams\.get\('result'\) \|\| 'false'\)/);
	assert.match(source, /finish\(result, true\)/);
	assert.match(source, /finish\(false\)/);
});

test('Firefox page action bundle avoids static chrome.action API references', () => {
	const source = read('lib/environment/background/pageAction.js');

	assert.match(source, /const pageAction = chrome\[process\.env\.BUILD_TARGET === 'firefox' \? 'pageAction' : 'action'\]/);
	assert.match(source, /function showPageAction\(tabId\)/);
	assert.match(source, /function hidePageAction\(tabId\)/);
	assert.doesNotMatch(source, /chrome\.action/);
});
