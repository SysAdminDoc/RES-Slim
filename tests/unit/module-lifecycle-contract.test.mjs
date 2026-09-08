// The signal every module stage is handed, and when it is allowed to end.
//
// It ends when the document does. It must not end when the document is only
// being put into the back/forward cache: that document comes back with its
// listeners and its content script intact, and a signal aborted on the way in is
// still aborted on the way out. `init.js` says all of this about `pageSignal`
// and had the guard; this file's controller did not, so after Back to an old
// Reddit page every module held a dead stage signal while the page signal was
// fine.
//
// What that cost in practice: `systemThemeSync` and `pageTheme` remove their
// media-query listeners on abort and their latches refuse to arm again, so an OS
// light/dark switch stopped applying after Back until the next real load.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readRepoFile } from './helpers/loadFlowModule.mjs';
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

test('a page put into the back/forward cache keeps its stage signal', async () => {
	const Modules = await loadModule('lib/core/modules/modules.js', 'module-lifecycle-bfcache');
	const search = Modules.get('search');
	let receivedSignal;

	search.afterLoad = signal => { receivedSignal = signal; };
	Modules.allowedModules.push('search');
	await Modules._loadModulePrefs();
	await Modules._runModuleStage('afterLoad');
	assert.equal(receivedSignal.aborted, false);

	// Into the cache. The document is coming back.
	const intoCache = new Event('pagehide');
	// jsdom's PageTransitionEvent is not constructible here, so the flag is set on
	// an ordinary Event -- which is what the handler reads.
	Reflect.defineProperty(intoCache, 'persisted', { value: true });
	window.dispatchEvent(intoCache);
	assert.equal(receivedSignal.aborted, false, 'a bfcache pagehide ended the stage signal');

	// A second one, because a page can be cached and then really unloaded, and the
	// first must not have consumed the listener.
	const secondCache = new Event('pagehide');
	Reflect.defineProperty(secondCache, 'persisted', { value: true });
	window.dispatchEvent(secondCache);
	assert.equal(receivedSignal.aborted, false);

	// Actually leaving.
	const leaving = new Event('pagehide');
	Reflect.defineProperty(leaving, 'persisted', { value: false });
	window.dispatchEvent(leaving);
	assert.equal(receivedSignal.aborted, true, 'a real pagehide has to end it');
});

test('the two lifetimes agree about what ends a page', () => {
	// They disagreed for one reason: the guard was added to one file and not the
	// other. Reading both is the cheapest thing that notices if it happens again.
	const read = file => readRepoFile(file).replace(/\s+/g, ' ');
	for (const file of ['lib/core/init.js', 'lib/core/modules/modules.js']) {
		assert.match(
			read(file),
			/addEventListener\('pagehide', \(event: any\) => \{ if \(!event \|\| !event\.persisted\)/,
			`${file} ends its lifetime on a bfcache pagehide`,
		);
		assert.ok(
			!/addEventListener\('pagehide'[^)]*\{ once: true \}/.test(read(file)),
			`${file} consumes its pagehide listener on the first one`,
		);
	}
});
