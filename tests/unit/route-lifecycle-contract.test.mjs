import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';

// Current Reddit navigates without unloading. Nothing in the module lifecycle
// knew that: a page stage ran once, so a module that only became eligible after
// a route change never ran at all, and work a module started for the listing you
// left kept running while you read a comment thread with nothing able to cancel
// it.
//
// Three of the four claims here are about wiring — which listener exists, which
// signal is passed, which set is consulted — and a unit test can hold those
// honestly. The fourth, that a listing-to-comments-to-profile walk produces no
// duplicate observers, is a browser claim and lives in the e2e suite.

const init = readRepoFile('lib/core/init.js');
const modules = readRepoFile('lib/core/modules/modules.js');
const watcher = readRepoFile('lib/utils/watchers_d2x.js');

test('a pushState with no DOM mutation is still a route change', () => {
	// It used to be noticed only from inside the MutationObserver, so a URL swap
	// with no accompanying DOM change — which is what reddit does, because it
	// changes the URL before rendering the new view — was never seen.
	assert.match(watcher, /navigation\.addEventListener\('navigatesuccess', notifyLocationChange\)/);
	// Guarded, because Firefox does not ship the Navigation API and the older
	// paths are what it falls back to.
	assert.match(watcher, /typeof navigation !== 'undefined' && navigation && typeof navigation\.addEventListener === 'function'/);
	assert.match(watcher, /window\.addEventListener\('popstate', notifyLocationChange\)/, 'the back button still has to work without it');
});

test('every source runs through one dedupe, keyed on what reddit says the page is', () => {
	// Three sources can notice one navigation. Without a shared key that is three
	// events, and every route-scoped teardown runs three times.
	assert.match(watcher, /const routeKey = \(\) => \{/);
	assert.match(watcher, /app\.getAttribute\('pagetype'\)/);
	assert.match(watcher, /app\.getAttribute\('routename'\)/);
	assert.match(watcher, /if \(next === previousRoute\) return;/);

	// And an authoritative page type arriving after the URL is itself a change
	// worth reporting, which needs an observer on the attribute rather than on
	// the document.
	assert.match(watcher, /attributeFilter: \['pagetype', 'routename'\]/);
});

test('the page type is authoritative before anything decides which modules belong', () => {
	// `/r/x/s/<id>` share links are post pages that match no path pattern, so the
	// fallback calls them `linklist` and every comments-scoped module sits the
	// page out — permanently, because a page stage runs once.
	assert.match(init, /waitForDescendant\(document\.documentElement, 'shreddit-app'/);
	assert.match(init, /const authoritativePageType/);
	// Bounded and swallowed: a page that never grows one is not a page to refuse
	// to start on.
	assert.match(init, /timeout: 5000/);
	assert.match(init, /\.then\(\(\) => \{\}, \(\) => \{\}\)/);
});

test('both page stages derive from the same gate, or the watcher scan overtakes them', () => {
	// `initD2xWatcher` defers its first scan by exactly one microtask because the
	// contentStart and go handlers register their Thing watchers in that same
	// turn. Gating only one of them puts it a turn later than the scan, and every
	// module registering a `watchForThings` in `contentStart` misses every post
	// present at load. Measured: the absolute timestamps stopped appearing.
	assert.match(init, /const pageReady: Promise<\*> = Promise\.all\(\[beforeLoad, PagePhases\.contentStart\]\)\s*\n\s*\.then\(authoritativePageType\);/);
	assert.match(init, /export const contentStart: Promise<\*> = pageReady/);
	assert.match(init, /export const go: Promise<\*> = pageReady/);
});

test('a route change aborts the previous route scope and starts a new one', () => {
	assert.match(modules, /export function getRouteSignal\(\): AbortSignal/);
	assert.match(modules, /export function _startRouteScope\(\)/);
	assert.match(modules, /routeController\.abort\(\);\s*\n\s*routeController = new AbortController\(\);/);
	assert.match(init, /document\.addEventListener\('reddit\.urlChanged', \(\) => \{[\s\S]*?_startRouteScope\(\);/);

	// The lifecycle signal is a different, longer scope and must stay that way:
	// a module that wants to live as long as the tab still has one.
	assert.match(modules, /const lifecycleController = new AbortController\(\);/);
});

test('only modules that have newly become eligible get a second page stage', () => {
	// Re-running a stage for a module that already had it is how you get two of
	// every observer and injected control it made.
	assert.match(modules, /const stagesRun: Set<string> = new Set\(\);/);
	assert.match(modules, /!stagesRun\.has\(`\$\{stage\}\|\$\{module\.moduleID\}`\)/);
	assert.match(modules, /export async function _runNewlyEligibleStage/);
	// The ordinary path has to record what it ran, or the route path would treat
	// every module as new.
	assert.match(modules, /stagesRun\.add\(`\$\{stage\}\|\$\{module\.moduleID\}`\)/);

	for (const stage of ['contentStart', 'go', 'afterLoad']) {
		assert.match(init, new RegExp(`_runNewlyEligibleStage\\('${stage}'\\)`), `${stage} is page-scoped and has to be offered again`);
	}
	// `always` and `beforeLoad` are not page-scoped and must not be re-run here:
	// `always` is re-run on option changes by a different path entirely.
	const routeBlock = init.slice(init.indexOf('document.addEventListener(\'reddit.urlChanged\''));
	assert.ok(!/_runNewlyEligibleStage\('always'\)/.test(routeBlock));
	assert.ok(!/_runNewlyEligibleStage\('beforeLoad'\)/.test(routeBlock));
});

test('the memoized page type is cleared before the new route is judged', () => {
	// `isRunning` reads `pageType()`, which is memoized. Judging eligibility for
	// the new route against the old page type would pick the wrong modules.
	const routeBlock = codeOnly(init).slice(codeOnly(init).indexOf('document.addEventListener(\'reddit.urlChanged\''));
	const clearAt = routeBlock.indexOf('pageType.cache.clear()');
	const runAt = routeBlock.indexOf('_runNewlyEligibleStage');
	assert.ok(clearAt > -1, 'the memoized page type has to be cleared');
	assert.ok(runAt > -1);
	assert.ok(clearAt < runAt, 'clearing after the stages run judges them against the page that was left');
});
