// Declining a browser permission has to look like declining something.
//
// A module that needs a host permission asks for it when the reader switches it
// on. Decline the prompt -- or close the tab it opened, which resolves the same
// way -- and the console returned early: the switch did not move and nothing was
// said. The only thing the reader learned is that the toggle appears not to
// work, and the obvious next move is to click it again and get the same prompt.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, readRepoFile } from './helpers/loadFlowModule.mjs';

const source = codeOnly(readRepoFile('lib/options/settingsConsole.js'));
const toggle = source.slice(source.indexOf('async function toggleModuleEnabled'), source.indexOf('async function toggleModuleEnabled') + 2200);

test('a declined permission says which module and which permission', () => {
	const declined = toggle.slice(toggle.indexOf('await Permissions.request(permissions);'));
	assert.match(declined, /if \(!await Permissions\.has\(permissions\)\) \{/, 'the decline path is not where it was');

	// The message names both, because "a permission was declined" on a page with
	// a hundred toggles is not a message.
	assert.match(declined, /settingsStatus\(/, 'the reader is still told nothing');
	assert.match(declined, /settingsConsolePermissionDeclined/);
	assert.match(declined, /i18n\(mod\.moduleName\) \|\| moduleID/, 'the message does not name the module');
	assert.match(declined, /permissions\.join\(', '\)/, 'the message does not name the permission');
	assert.match(declined, /isError: true/, 'a refusal is shown as an ordinary status');
});

test('the switch is put back where it was, and nothing is staged', () => {
	const declined = toggle.slice(toggle.indexOf('await Permissions.request(permissions);'));
	const returnAt = declined.indexOf('return;');
	const stageAt = declined.indexOf('Options.stage.addModule');

	assert.ok(returnAt > -1);
	assert.ok(stageAt === -1 || returnAt < stageAt, 'a declined permission still stages the module as enabled');

	// The sidebar and the module panel are both redrawn from what is actually
	// stored, because a control that is out of step with storage is the same
	// confusion one layer down.
	assert.match(declined.slice(0, returnAt), /syncSidebarModuleState\(moduleID, getModuleEnabled\(moduleID\)\)/);
	assert.match(declined.slice(0, returnAt), /updateCurrentModuleState\(Modules\.get\(moduleID\)\)/);
});

test('the message reads as a sentence about what happened', () => {
	// It is shown on its own in a chip, with no heading and no module name beside
	// it, so it has to carry both.
	const locale = JSON.parse(readRepoFile('locales/locales/en.json'));
	const message = locale.settingsConsolePermissionDeclined.message;

	assert.match(message, /\$1/, 'the module is never substituted in');
	assert.match(message, /\$2/, 'the permission is never substituted in');
	assert.match(message, /declined/i);
	assert.ok(!message.includes('—') && !message.includes('–'), 'no dashes in reader-facing text');

	const rendered = message.replace('$1', 'Show images').replace('$2', 'https://*.imgur.com/*');
	assert.equal(rendered, 'Show images was not switched on: the browser permission it needs (https://*.imgur.com/*) was declined.');
});

test('a granted permission still switches the module on', () => {
	// The guard has to be the decline path and nothing wider.
	const granted = toggle.slice(0, toggle.indexOf('await Permissions.request(permissions);'));
	assert.match(granted, /if \(permissions\.length && !await Permissions\.has\(permissions\)\) \{/);
	// Which means a module that needs nothing never reaches any of this.
	assert.match(toggle, /const enable = !getModuleEnabled\(moduleID\);/);
	assert.match(toggle, /if \(enable\) \{/, 'the permission check runs when switching off as well');
});
