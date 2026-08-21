import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';

test('module lifecycle stages receive one abort signal', async () => {
	const Modules = await loadModule('lib/core/modules/modules.js', 'module-lifecycle');
	const search = Modules.get('search');
	let receivedSignal;

	search.afterLoad = signal => {
		receivedSignal = signal;
	};
	Modules.allowedModules.push('search');
	await Modules._loadModulePrefs();
	await Modules._runModuleStage('afterLoad');

	assert.ok(receivedSignal instanceof AbortSignal);
	assert.equal(receivedSignal.aborted, false);
	Modules.abortModules();
	assert.equal(receivedSignal.aborted, true);
});
