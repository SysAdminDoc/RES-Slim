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
	waitForDescendant,
} from '../utils';
import { makeModuleErrorEntry } from '../utils/moduleErrorLog';
import { recordModuleErrorOnce } from './modules/storage';
import { recordSelectorDiagnostics } from './dom/selectorDiagnostics';
import { loadSelectorOverrides } from './dom/selectorOverrideStorage';
import { _loadModuleOptions } from './options/options';
import { _loadModulePrefs, _runModuleStage, _runNewlyEligibleStage, _startRouteScope } from './modules/modules';
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
// Aborted when the document is actually going away. Not on a `pagehide` that is
// only putting the page into the back/forward cache: that document comes back
// with its listeners and its content script intact, and a signal aborted on the
// way in would still be aborted on the way out. `waitWith` rejects immediately
// on an already-aborted signal, so every waiter taken after a bfcache restore
// would fail before observing anything — and the two in `watchers.js` are what
// register a Thing's visible tasks, so nothing appended after the restore would
// get an expando, a filter, or a vote colour.
const pageLifetime = new AbortController();

export const pageSignal: AbortSignal = pageLifetime.signal;

// Handed to `lib/utils/dom.js`, which cannot import this file.
setPageSignal(pageSignal);

if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('pagehide', (event: any) => {
		if (!event || !event.persisted) pageLifetime.abort();
	});
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

// What current Reddit says the page is, before anything decides which modules
// belong on it.
//
// `pageType()` reads `shreddit-app`'s `pagetype` and `routename` and falls back
// to matching the path when the element is not there yet. The fallback gets
// `/r/x/s/<id>` share links wrong — they are post pages and match no pattern, so
// they come out as `linklist` and every comments-scoped module sits the page out
// permanently, because a page stage runs once.
//
// The element is in reddit's server-rendered HTML, so in practice this resolves
// immediately. Bounded and swallowed anyway: a page that never grows one is not
// a page to refuse to start on.
const authoritativePageType = () => (isAppType('d2x') ?
	waitForDescendant(document.documentElement, 'shreddit-app', { timeout: 5000, owner: 'core', signal: pageSignal })
		.then(() => {}, () => {}) :
	Promise.resolve());

// Every page stage waits on this, so which modules belong is decided once, from
// reddit's own answer rather than from a guess about the path. Deliberately not
// gated on `PagePhases.contentStart`: `beforeLoad` is meant to run before the
// page content is processed, and the element it waits for is in the
// server-rendered HTML.
const pageReady: Promise<*> = Promise.all([loadI18n, loadOptions])
	.then(authoritativePageType);

// `beforeLoad` is gated too, and it is the stage that needed it most.
//
// Two modules — `hideChildComments` and `readComments` — have `beforeLoad` as
// their only stage, and both are comments-scoped. Gating only `contentStart`
// left them judged against the path guess, so on a `/r/x/s/<id>` share link they
// ran zero times rather than once, which is the case this whole change is named
// after. Measured on a page whose `shreddit-app` arrived at 900ms: fourteen
// `beforeLoad` measures, none of them for a comments-scoped module.
export const beforeLoad: Promise<void> = pageReady
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

// A route change on current Reddit, which is a navigation with no unload.
//
// Two things have to happen, and neither did. The route scope is aborted and
// replaced, so work a module started for the page you have left can be cancelled
// rather than running against a page that no longer exists. And the page-scoped
// stages are offered to modules that have only now become eligible — a module
// whose `include` finally matches has never had its `contentStart`, and a page
// stage running once meant it never would.
//
// Only newly eligible modules. Re-running a stage for a module that already had
// it is how you get two of every observer and injected control it made.
if (typeof document !== 'undefined' && document.addEventListener) {
	document.addEventListener('reddit.urlChanged', () => {
		_startRouteScope();
		pageType.cache.clear();
		// In order, not in parallel. The ordinary lifecycle guarantees a module's
		// `beforeLoad` finishes before its `contentStart` starts; dispatching all
		// four at once inverts that for any module that owns more than one.
		(async () => {
			for (const stage of ['beforeLoad', 'contentStart', 'go', 'afterLoad']) {
				await _runNewlyEligibleStage(stage); // eslint-disable-line no-await-in-loop
			}
		})().catch(error => {
			console.error('[RES-Slim] Could not run route-scoped module stages:', error);
		});
	});
}

// BodyClasses may have been added before document.body was ready
Promise.all([onInit, PagePhases.bodyStart]).then(BodyClasses.addMissing);

afterLoad.then(() => {
	window.rsmDiagnostics = getModuleSummary;
	const slow = getModuleSummary().filter(m => m.totalMs > 50);
	if (slow.length) {
		console.warn('[RES-Slim] Slow modules (>50ms):', slow.map(m => `${m.moduleID}: ${m.totalMs}ms`).join(', '));
	}
});
