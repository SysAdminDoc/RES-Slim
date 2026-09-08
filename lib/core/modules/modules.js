/* @flow */

import { i18n } from '../../environment';
import {
	downcast,
	matchesPageLocation,
	markStart,
	markEnd,
} from '../../utils';
import { Module, getModuleId } from '../module';

import type { OpaqueModuleId } from '../module';
import { makeModuleErrorEntry } from '../../utils/moduleErrorLog';
import { storage, setEnabled as persistEnabled, recordModuleError } from './storage';
import brokenFeatures from './broken-features.json';

const enabled = new Map();
const brokenModuleIDs = new Set(brokenFeatures);
const lifecycleController = new AbortController();

const modules = new Map();

// Aborted when the document is actually going away, and not on a `pagehide` that
// is only putting the page into the back/forward cache.
//
// `init.js` learned this and this file did not, so the two signals disagreed by
// omission. A bfcache document comes back with its listeners and its content
// script intact, and a signal aborted on the way in is still aborted on the way
// out -- so after Back to an old-Reddit page, every module held a permanently
// dead stage signal while `pageSignal` was fine. The visible effect is small
// today and only because few things use it: `systemThemeSync` and `pageTheme`
// remove their media-query listeners on abort and their latches refuse to arm
// again, so an OS light/dark switch or a High Contrast toggle stopped applying
// after Back until the next real load.
//
// No `once`, because a page can be hidden into the cache and hidden again for
// real, and the first of those must not consume the listener.
if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('pagehide', (event: any) => {
		if (!event || !event.persisted) lifecycleController.abort();
	});
}

export function abortModules() {
	lifecycleController.abort();
}

// A second, shorter scope than the page's.
//
// `lifecycleController` lives as long as the document. On current Reddit that is
// the whole browsing session: reddit replaces the feed, the comment tree and the
// page type without ever unloading, so work a module started for the listing you
// were on is still running while you read a comment thread. Nothing could cancel
// it, because nothing represented "the route you started this for is over".
//
// Aborted and replaced on every route change. A module that wants to be cancelled
// when the reader navigates asks for this; one that wants to live as long as the
// tab keeps using the lifecycle signal it already gets.
let routeController = new AbortController();

export function getRouteSignal(): AbortSignal {
	return routeController.signal;
}

// Which (stage, module) pairs have already run, so a re-run after a route change
// starts only the modules that were not eligible before. Running `contentStart`
// twice for the same module is how you get two of every observer it registered.
const stagesRun: Set<string> = new Set();

// The stages a route change may offer again, and therefore the only ones whose
// second run has to be refused.
//
// Recording alone was not enough: `afterLoad` sits behind `window load`, which on
// reddit is seconds after `go`, so a route change in that gap ran it for every
// eligible module and then `load` ran it for all of them again. Measured with a
// held-open `load`: RESMenu, newCommentCount, selectedEntry, showImages and
// version each ran twice — two IntersectionObservers and a second scroll
// listener from showImages alone.
//
// `always` is deliberately absent: it is not offered again by a route change.
const ROUTE_SCOPED_STAGES = new Set(['beforeLoad', 'contentStart', 'go', 'afterLoad']);

function alreadyRan(stage: string, moduleID: string): boolean {
	return ROUTE_SCOPED_STAGES.has(stage) && stagesRun.has(`${stage}|${moduleID}`);
}

export function _startRouteScope() {
	routeController.abort();
	routeController = new AbortController();
}

// Run `fn` for the route the reader is on now, and again for every route after
// it, with the signal that ends when that route does.
//
// The stage path cannot do this and should not be made to. `_runNewlyEligibleStage`
// records `stage|module` forever, so a module that arms on the route signal is
// cancelled by `_startRouteScope()` on the next navigation and then refused by
// the already-ran filter while it is still eligible -- alive on the route it
// started on and dead on every route after. That is not a bug in the filter:
// re-running `contentStart` is how you get two of every observer a module made.
// Arming per route is a different thing from running a stage again, and it needs
// its own door.
//
// `infiniteScroll` found the shape first and kept it to itself, which meant the
// only test of it tested that one module rather than the mechanism.
const routeArms: Map<string, () => void> = new Map();

export function armOnRoute(moduleID: string, fn: (signal: AbortSignal) => void): void {
	// Keyed per module, so arming twice replaces rather than doubles. A module that
	// calls this from a stage that runs again would otherwise stack listeners.
	const existing = routeArms.get(moduleID);
	if (existing) document.removeEventListener('reddit.urlChanged', existing);

	const arm = () => { fn(routeController.signal); };
	routeArms.set(moduleID, arm);
	// On the document, not on a route signal. The subscription that does the
	// re-arming has to outlive the route it was made on, and a route-scoped signal
	// is exactly what would cancel it.
	//
	// `init.js` registers its own listener at module evaluation, well before any
	// module reaches a stage, and that listener starts the new route scope before
	// this one runs -- so `fn` is handed the signal for the route being entered
	// rather than the one being left.
	document.addEventListener('reddit.urlChanged', arm);
	arm();
}

// Only the tests need this: a module registry is per page in the product, and
// two contracts in one file would otherwise inherit each other's arms.
export function _clearRouteArms() {
	for (const arm of routeArms.values()) document.removeEventListener('reddit.urlChanged', arm);
	routeArms.clear();
}

export function registerModules(registry: Array<Module<any>>) {
	if (modules.size) throw new Error('Module registry has already been populated.');
	for (const candidate of registry) {
		const module = downcast(candidate, Module);
		if (modules.has(module.moduleID)) throw new Error(`Duplicate module id "${module.moduleID}".`);
		modules.set(module.moduleID, module);
	}
}

if (process.env.NODE_ENV === 'development') {
	// for debugging only! do not use `modules` in any committed code
	window.modules = modules;
}

// When containing modules, no other modules other than those specified should run
// Stages `beforeLoad`, `go`, `afterLoad` may only be executed on these modules
export const allowedModules: Array<string> = [];

export async function _loadModulePrefs() {
	const storedPrefs = await storage.getAll();

	for (const [id, module] of modules) {
		if (brokenModuleIDs.has(id)) {
			enabled.set(id, false);
		} else if (module.alwaysEnabled) {
			enabled.set(id, true);
		} else if (storedPrefs.hasOwnProperty(id)) {
			enabled.set(id, storedPrefs[id]);
		} else {
			enabled.set(id, !module.disabledByDefault);
		}
	}
}

const ERRORED_KEY = Symbol('errored');
export async function _runModuleStage(stage: $Keys<Module<any>>, { skipEnabledCheck = false }: {| skipEnabledCheck?: boolean |} = {}) {
	await Promise.all(
		all()
			.filter(module => (
				module[stage] &&
				!module[ERRORED_KEY] &&
				!brokenModuleIDs.has(module.moduleID) &&
				!alreadyRan(stage, module.moduleID) &&
				(skipEnabledCheck || isRunning(module))
			))
			.map(async module => {
				const tag = markStart();
				stagesRun.add(`${stage}|${module.moduleID}`);
				try {
					const fn = module[stage];
					await fn(lifecycleController.signal);
				} catch (e) {
					module[ERRORED_KEY] = true;
					console.error('Error in module:', module.moduleID, 'during:', stage);
					console.error(e);
					recordModuleError(makeModuleErrorEntry(module.moduleID, stage, e)).catch(storageError => {
						console.error('Error in module error log:', storageError);
					});
				}
				markEnd(tag, `${module.moduleID} (${stage})`);
			}),
	);
}

// Run a page-scoped stage for modules that have become eligible since the last
// time it ran, and for nobody else.
//
// This is the half a route change needs that a plain re-run cannot give it: a
// module whose `include` finally matches has never had its `contentStart`, while
// one that was already running has, and running it again would duplicate every
// watcher, observer and injected control it made.
export async function _runNewlyEligibleStage(stage: $Keys<Module<any>>): Promise<Array<string>> {
	const pending = all().filter(module => (
		module[stage] &&
		!module[ERRORED_KEY] &&
		!brokenModuleIDs.has(module.moduleID) &&
		isRunning(module) &&
		!stagesRun.has(`${stage}|${module.moduleID}`)
	));

	await Promise.all(pending.map(async module => {
		stagesRun.add(`${stage}|${module.moduleID}`);
		const tag = markStart();
		try {
			const fn = module[stage];
			// The route signal, not the lifecycle one. Work a module starts because
			// this route made it eligible has to end when the route does; handing it
			// the page-length signal is what made the route scope a no-op with no
			// subscribers.
			await fn(routeController.signal);
		} catch (e) {
			module[ERRORED_KEY] = true;
			console.error('Error in module:', module.moduleID, 'during:', stage);
			console.error(e);
			recordModuleError(makeModuleErrorEntry(module.moduleID, stage, e)).catch(storageError => {
				console.error('Error in module error log:', storageError);
			});
		}
		markEnd(tag, `${module.moduleID} (${stage}, route)`);
	}));

	return pending.map(module => module.moduleID);
}

export function all(): Array<Module<any>> {
	return Array.from(modules.values());
}

export function isEnabled(opaqueId: OpaqueModuleId): boolean {
	const moduleID = get(opaqueId).moduleID;
	return !brokenModuleIDs.has(moduleID) && !!enabled.get(moduleID);
}

export function setEnabled(opaqueId: OpaqueModuleId, enable: boolean) {
	const moduleID = getModuleId(opaqueId);
	if (brokenModuleIDs.has(moduleID)) enable = false;
	enabled.set(moduleID, enable);
	return persistEnabled(moduleID, enable);
}

export function isRunning(opaqueId: OpaqueModuleId): boolean {
	const module = get(opaqueId);
	return (
		(!allowedModules.length || allowedModules.includes(module.moduleID)) &&
		isEnabled(module) &&
		matchesPageLocation(module.include, module.exclude) &&
		module.asLongAs.every(predicate => predicate())
	);
}

export function get(opaqueId: OpaqueModuleId): Module<any> {
	const id = getModuleId(opaqueId);
	const existing = getUnchecked(id);
	if (existing) return existing;

	// Focused module tests import one implementation without an application
	// entry point. Register that concrete object on first use so those tests keep
	// exercising the same isRunning path as the product.
	const candidate = opaqueId && opaqueId.module ? opaqueId.module : opaqueId;
	if (candidate instanceof Module) {
		modules.set(id, candidate);
		return candidate;
	}

	return _get(id);
}

function _get(id) {
	const mod = getUnchecked(id);
	if (!mod) throw new Error(`Module "${id}" not found.`);
	return mod;
}

export function getUnchecked(id: string): void | Module<any> {
	return modules.get(id);
}

export function getByCategory(category: string): Array<Module<any>> {
	return all()
		.filter(module => !module.hidden)
		.filter(module => module.category === category)
		.sort((a, b) => {
			const sortComparison = (a.sort || 0) - (b.sort || 0);
			if (sortComparison !== 0) {
				return sortComparison;
			}

			return (i18n(a.moduleName).toLowerCase() > i18n(b.moduleName).toLowerCase()) ? 1 : -1;
		});
}
