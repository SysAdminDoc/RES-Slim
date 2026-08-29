/* @flow */

import { once } from '../utils/functional';
import { _loadI18n } from '../environment';
import {
	BodyClasses,
	PagePhases,
	r2WatcherContentLoaded,
	r2WatcherContentStart,
	initD2xWatcher,
	isAppType,
	appType,
	pageType,
	getModuleSummary,
	setPageSignal,
	setWaitTimeoutReporter,
} from '../utils';
import { makeModuleErrorEntry } from '../utils/moduleErrorLog';
import { recordModuleErrorOnce } from './modules/storage';
import { recordSelectorDiagnostics } from './dom/selectorDiagnostics';
import { loadSelectorOverrides } from './dom/selectorOverrideStorage';
import { _loadModuleOptions } from './options/options';
import { _loadModulePrefs, _runModuleStage } from './modules/modules';
import { _addModuleBodyClasses } from './modules/bodyClasses';

// load environment listeners
import '../environment/foreground/messaging';
import '../environment/foreground/multicast';
import '../environment/foreground/pageAction';

// The DOM waiters live in `lib/utils/`, which may not import `lib/core/`, so the
// reporting half is installed from this side. Before this existed a selector
// that never appeared produced nothing at all — no rejection, no log line, and a
// MutationObserver left attached for the life of the page. That is why only two
// of 115 modules ever wrote to the module error log.
setWaitTimeoutReporter(({ owner, describe, timeout }) => {
	recordModuleErrorOnce(makeModuleErrorEntry(
		owner || 'unknown',
		'wait-timeout',
		`Waited ${timeout}ms for ${describe} on a '${String(pageType())}' page and it never appeared.`,
	)).catch(() => {
		// Reporting a failure must not become a second failure. The caller still
		// gets the rejection.
	});
});

// The signal every open-ended wait in this extension hangs off.
//
// A waiter that legitimately has no deadline — an expando the reader may never
// open, a hover target that may never be removed — still has to be able to let
// go of its observer. Without one, `waitForSelectorMatch` left an attribute
// observer and a pending async frame per link post, for the life of the page,
// accumulating across an infinite scroll. `dom.js` cannot own this: it may not
// import `lib/core/`, and it has no idea when a page is finished.
//
// Aborted when the document goes away, and on a current-Reddit route change,
// which is the point at which the previous page's waits can no longer resolve.
const pageLifetime = new AbortController();

export const pageSignal: AbortSignal = pageLifetime.signal;

// Handed to `lib/utils/dom.js`, which cannot import this file.
setPageSignal(pageSignal);

if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('pagehide', () => pageLifetime.abort(), { once: true });
}

let _init;

export function init() {
	_init();
}

const start = new Promise(resolve => { _init = resolve; });

// Module stages

export const loadI18n: Promise<void> = start
	.then(() => _loadI18n());

export const loadSelectors: Promise<*> = start
	.then(() => loadSelectorOverrides());

export const onInit: Promise<void> = loadSelectors
	.then(() => _runModuleStage('onInit', { skipEnabledCheck: true }));

export const loadOptions: Promise<*> = onInit
	.then(() => Promise.all([
		_loadModuleOptions(),
		_loadModulePrefs(),
	]));

export const addModuleBodyClasses: Promise<void> = loadOptions
	.then(() => _addModuleBodyClasses());

export const always: Promise<void> = Promise.all([loadI18n, loadOptions])

	.then(() => _runModuleStage('always', { skipEnabledCheck: true }));

export const beforeLoad: Promise<void> = Promise.all([loadI18n, loadOptions])
	.then(() => _runModuleStage('beforeLoad'));

export const contentStart: Promise<*> = Promise.all([beforeLoad, PagePhases.contentStart])
	.then(() => Promise.all([
		_runModuleStage('contentStart'),
		isAppType('r2') ? r2WatcherContentStart() : undefined,
	]));

export const go: Promise<*> = Promise.all([beforeLoad, PagePhases.contentStart])
	.then(() => {
		const run = once(() => Promise.all([
			isAppType('d2x') ? initD2xWatcher() : r2WatcherContentLoaded(),
			_runModuleStage('go'),
		]));
		// Prevent additional forced reflow in Reddit's scripts by running first thing on the `DOMContentLoaded` event
		window.addEventListener('DOMContentLoaded', run, true);
		return PagePhases.contentLoaded.then(run);
	});

export const selectorDiagnostics: Promise<*> = go
	// Both renderers. This was `isAppType('r2')`, so drift detection covered the
	// renderer that stopped changing and not the one that ships continuously.
	.then(() => (isAppType('r2') || isAppType('d2x')) ?
		recordSelectorDiagnostics(pageType(), document, Date.now(), appType()) :
		undefined)
	.catch(error => {
		// Diagnostics must never prevent the rest of the extension lifecycle.
		console.error('[RES-Slim] Could not record selector diagnostics:', error);
	});

export const afterLoad: Promise<void> = Promise.all([selectorDiagnostics, PagePhases.loadComplete])
	.then(() => _runModuleStage('afterLoad'));

// BodyClasses may have been added before document.body was ready
Promise.all([onInit, PagePhases.bodyStart]).then(BodyClasses.addMissing);

afterLoad.then(() => {
	window.rsmDiagnostics = getModuleSummary;
	const slow = getModuleSummary().filter(m => m.totalMs > 50);
	if (slow.length) {
		console.warn('[RES-Slim] Slow modules (>50ms):', slow.map(m => `${m.moduleID}: ${m.totalMs}ms`).join(', '));
	}
});
