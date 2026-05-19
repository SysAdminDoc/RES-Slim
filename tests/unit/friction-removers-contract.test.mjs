import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

test('frictionRemovers is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as frictionRemovers \} from '\.\/frictionRemovers';/);
	assert.match(index, /^\s*frictionRemovers,/m);
});

test('frictionRemovers wires every friction surface to its own opt-out switch', () => {
	const source = read('lib/modules/frictionRemovers.js');
	for (const opt of [
		'autoConfirmOver18',
		'autoConfirmQuarantine',
		'hideNewRedditBanner',
		'hideAppPrompt',
	]) {
		assert.match(source, new RegExp(`${opt}:\\s*\\{[\\s\\S]*?value:\\s*true`), `${opt} should default to true`);
	}
});

test('frictionRemovers auto-submits the over18 and quarantine forms on those routes', () => {
	const source = read('lib/modules/frictionRemovers.js');
	assert.match(source, /autoSubmitForm\('\/over18'\)/);
	assert.match(source, /autoSubmitForm\('\/quarantine'\)/);
	assert.match(source, /\\\/over18/);
	assert.match(source, /\\\/quarantine/);
});

test('frictionRemovers injects a CSS rule that hides all enabled banner selectors', () => {
	const source = read('lib/modules/frictionRemovers.js');
	assert.match(source, /display:\s*none\s*!important/);
	assert.match(source, /'#new-reddit-pref-modal'/);
	assert.match(source, /'#redditmobile-app-banner'/);
});

test('frictionRemovers stays in the privacy category and the r2 (old reddit) include', () => {
	const source = read('lib/modules/frictionRemovers.js');
	assert.match(source, /module\.category\s*=\s*'privacyCategory'/);
	assert.match(source, /module\.include\s*=\s*\['r2'\]/);
});
