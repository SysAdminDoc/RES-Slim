// Declining a browser permission has to look like declining something.
//
// A module that needs a host permission asks for it when the reader switches it
// on. Decline the prompt, or close the tab it opened, which the background
// resolves the same way, and the rejection came straight back out of
// `toggleModuleEnabled` into no handler at all: the switch did not move and
// nothing was said. The only thing the reader learned is that the toggle appears
// not to work, and the obvious next move is to click it again and get the same
// prompt.
//
// The first attempt at this read `Permissions.has` after the request and
// reported a decline from that. It never ran. `request` rejects on a refusal, so
// nothing after it executes -- which is why the first test here is about
// `request` rather than about the console: it is the fact the console's fix
// depends on, and it went unstated once already.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

// ------------------------------------------------- what a refusal actually does

const messages = [];
globalThis.__permissionAnswer = () => true;

const Permissions = await loadFlowModule('lib/environment/foreground/permissions.js', 'permission-decline-perms', {
	stubs: {
		'./messaging': [
			'export const sendMessage = async (name, payload) => {',
			'	globalThis.__permissionMessages.push([name, payload]);',
			'	return globalThis.__permissionAnswer(payload);',
			'};',
		].join('\n'),
		// `memoize` and `mutex` are general helpers with their own tests; what is
		// under test here is the branch on the background's answer.
		'../../utils/functional': [
			'export const memoize = (fn, keyFn) => {',
			'	const cache = new Map();',
			'	const memoized = (...args) => {',
			'		const key = keyFn ? keyFn(...args) : args[0];',
			'		if (!cache.has(key)) cache.set(key, fn(...args));',
			'		return cache.get(key);',
			'	};',
			'	memoized.cache = cache;',
			'	return memoized;',
			'};',
		].join('\n'),
		'../../utils/async': 'export const mutex = fn => fn;\n',
	},
});
globalThis.__permissionMessages = messages;

test('a refused request rejects rather than resolving to false', async () => {
	// The console cannot report a decline it is never told about, and this is the
	// only signal there is. Chrome resolves `permissions.request` to `false` on a
	// refusal and the prompt tab does the same when the reader closes it, so both
	// shapes arrive here as a falsy answer from the background.
	messages.length = 0;
	globalThis.__permissionAnswer = () => false;

	await assert.rejects(
		Permissions.request(['https://web.archive.org/*']),
		/Permission not granted for: https:\/\/web\.archive\.org\/\*/,
	);
	assert.deepEqual(messages.map(([, payload]) => payload.operation), ['contains', 'request']);
});

test('a granted request resolves and is not asked again', async () => {
	// The positive control: if `request` rejected unconditionally the test above
	// would pass against a module that does nothing.
	messages.length = 0;
	globalThis.__permissionAnswer = payload => payload.operation !== 'contains';

	await Permissions.request(['downloads']);
	assert.equal(await Permissions.has(['downloads']), true, 'the grant was not remembered');
	assert.deepEqual(messages.map(([, payload]) => payload.operation), ['contains', 'request']);
	assert.deepEqual(messages[1][1], { operation: 'request', permissions: ['downloads'], origins: [] });
});

// ------------------------------------------------ what the reader is told it is

const summary = await loadFlowModule('lib/utils/permissionSummary.js', 'permission-decline-summary');

test('the reader is told the host, not the match pattern', () => {
	const describe = summary.describeRequestedAccess;

	assert.equal(describe(['https://web.archive.org/*']), 'web.archive.org');
	assert.equal(describe(['http://localhost/*', 'http://127.0.0.1/*']), 'localhost, 127.0.0.1');
	assert.equal(describe(['https://*.imgur.com/*']), 'imgur.com');
	// A named permission is already an English word, and is the word the browser's
	// own dialog used.
	assert.equal(describe(['history', 'tabs']), 'history, tabs');
	assert.equal(describe(['<all_urls>']), 'every site');
	assert.equal(describe(['https://*/*']), 'every site');
	// Two patterns on one host read as a mistake if both are printed.
	assert.equal(describe(['https://a.example/*', 'https://a.example/api/*']), 'a.example');
	// Nothing recognisable is left as it was written rather than reported as
	// something it is not.
	assert.equal(describe(['not a pattern://']), 'not a pattern://');
	assert.equal(describe([]), '');
	assert.equal(describe(['', null, 'history']), 'history');
});

test('the message reads as a sentence about what happened', () => {
	// It is shown on its own in a chip, with no heading and no module name beside
	// it, so it has to carry both.
	const locale = JSON.parse(readRepoFile('locales/locales/en.json'));
	const message = locale.settingsConsolePermissionDeclined.message;

	assert.match(message, /\$1/, 'the module is never substituted in');
	assert.match(message, /\$2/, 'the access is never substituted in');
	assert.ok(!message.includes('—') && !message.includes('–'), 'no dashes in reader-facing text');

	const rendered = message
		.replace('$1', 'Wayback snapshots')
		.replace('$2', summary.describeRequestedAccess(['https://web.archive.org/*']));
	assert.equal(rendered, 'Wayback snapshots was not switched on: the access it needs (web.archive.org) was not granted.');
});

// ------------------------------------------------------- where the console puts it

test('the console handles the rejection rather than reading a result', () => {
	const source = codeOnly(readRepoFile('lib/options/settingsConsole.js'));
	const start = source.indexOf('async function toggleModuleEnabled');
	assert.ok(start > -1);
	const toggle = source.slice(start, start + 2200);

	// The request is inside a try, and the catch is what reports. Reading
	// `Permissions.has` after the request is the shape that did not run.
	assert.match(toggle, /try \{\n\t+await Permissions\.request\(permissions\);\n\t+\} catch \(e\) \{/);
	assert.ok(
		!/await Permissions\.request\(permissions\);\s*\n\s*if \(!await Permissions\.has/.test(toggle),
		'the decline is still read off a result that never arrives',
	);

	const declined = toggle.slice(toggle.indexOf('} catch (e) {'));
	assert.match(declined, /settingsConsolePermissionDeclined/, 'the reader is still told nothing');
	assert.match(declined, /i18n\(mod\.moduleName\) \|\| moduleID/, 'the message does not name the module');
	assert.match(declined, /describeRequestedAccess\(permissions\)/, 'the raw match pattern is shown to the reader');
	assert.match(declined, /isError: true/, 'a refusal is shown as an ordinary status');

	// And nothing is staged: the catch returns before the toggle takes effect.
	const returnAt = declined.indexOf('return;');
	const stageAt = declined.indexOf('Options.stage.addModule');
	assert.ok(returnAt > -1);
	assert.ok(stageAt === -1 || returnAt < stageAt, 'a declined permission still stages the module as enabled');

	// The guard around all of it is the decline path and nothing wider: a module
	// that needs no permission never reaches any of this, and switching one off
	// never asks for anything.
	assert.match(toggle, /const enable = !getModuleEnabled\(moduleID\);/);
	assert.match(toggle, /if \(enable\) \{\n\t+const \{ requiredPermissions: permissions, message \}/);
	assert.match(toggle, /if \(permissions\.length && !await Permissions\.has\(permissions\)\) \{/);
});
