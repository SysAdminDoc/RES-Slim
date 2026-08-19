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
	pageType,
	getModuleSummary,
	setWaitTimeoutReporter,
} from '../utils';
import { makeModuleErrorEntry } from '../utils/moduleErrorLog';
import { recordModuleErrorOnce } from './modules/storage';
import { recordSelectorDiagnostics } from './dom/selectorDiagnostics';
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

let _init;

export function init() {
	_init();
}

const start = new Promise(resolve => { _init = resolve; });

// Module stages

export const loadI18n: Promise<void> = start
	.then(() => _loadI18n());

export const onInit: Promise<void> = start
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
	.then(() => isAppType('r2') ? recordSelectorDiagnostics(pageType()) : undefined)
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
