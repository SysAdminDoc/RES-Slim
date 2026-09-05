import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';
import { loadModule } from './helpers/loadModule.mjs';

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

test('the gate sits above beforeLoad, which is the stage that needed it most', () => {
	// `hideChildComments` and `readComments` have `beforeLoad` as their only stage
	// and are both comments-scoped, so gating only `contentStart` left them judged
	// against the path guess: on a `/r/x/s/<id>` share link they ran zero times
	// rather than once, which is the case this change is named after.
	assert.match(init, /const pageReady: Promise<\*> = Promise\.all\(\[loadI18n, loadOptions\]\)\s*\n\s*\.then\(authoritativePageType\);/);
	assert.match(init, /export const beforeLoad: Promise<void> = pageReady/);

	// And `contentStart` and `go` keep the prerequisites they always had, so
	// their relative order is untouched. Gating one and not the other put
	// `contentStart` a turn later than `initD2xWatcher`'s first scan, and every
	// module registering a Thing watcher there missed every post present at load.
	const prereq = /Promise\.all\(\[beforeLoad, PagePhases\.contentStart\]\)/g;
	assert.equal((init.match(prereq) || []).length, 2, 'contentStart and go must share their prerequisites');
});

test('a stage a route change can offer again cannot also be run twice by the ordinary path', () => {
	// Recording what ran was not enough on its own: `afterLoad` sits behind
	// `window load`, seconds after `go` on reddit, so a route change in that gap
	// ran it for every eligible module and then `load` ran all of them again.
	// Measured with a held-open `load`: five modules ran their `afterLoad` twice,
	// which is two IntersectionObservers and a second scroll listener from
	// `showImages` alone.
	assert.match(modules, /const ROUTE_SCOPED_STAGES = new Set\(\['beforeLoad', 'contentStart', 'go', 'afterLoad'\]\)/);
	assert.match(modules, /!alreadyRan\(stage, module\.moduleID\)/, 'the ordinary path has to refuse a second run too');
	// `always` is re-run on option changes by design and must not be caught by it.
	assert.ok(!/ROUTE_SCOPED_STAGES = new Set\(\[[^\]]*'always'/.test(modules));
});

test('work a route change starts is bound to that route, not to the page', () => {
	// `getRouteSignal` existed and nothing passed it, so the scope was aborted on
	// every navigation with no subscribers — structurally present, behaviourally a
	// no-op. A module that became eligible at one route kept its watchers running
	// at the next, where it was no longer eligible.
	const runner = modules.slice(modules.indexOf('export async function _runNewlyEligibleStage'));
	assert.match(runner, /await fn\(routeController\.signal\)/, 'the route stages have to be handed the route signal');
	assert.ok(!/await fn\(lifecycleController\.signal\)/.test(runner), 'the page-length signal outlives the route');
});

test('a route change aborts the previous route scope and starts a new one', () => {
	// `getRouteSignal` is not asserted here any more. That it *exists* was the
	// only thing this file ever checked about it, and it existed for weeks with
	// nothing calling it — so the claim is made below, by executing it.
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

	// Named in the loop the route handler walks, rather than as four calls.
	for (const stage of ['beforeLoad', 'contentStart', 'go', 'afterLoad']) {
		assert.match(init, new RegExp(`'${stage}'`), `${stage} is page-scoped and has to be offered again`);
	}
	// `always` is re-run on option changes by a different path entirely and must
	// not be offered here. `beforeLoad` is offered, because two comments-scoped
	// modules have it as their only stage and would otherwise never run on a page
	// they only became eligible for after a navigation.
	const routeBlock = init.slice(init.indexOf('document.addEventListener(\'reddit.urlChanged\''));
	assert.ok(!/'always'/.test(routeBlock));

	// In order. The ordinary lifecycle guarantees a module's `beforeLoad` finishes
	// before its `contentStart` starts, and dispatching them together inverts that
	// for any module owning more than one.
	assert.match(routeBlock, /for \(const stage of \['beforeLoad', 'contentStart', 'go', 'afterLoad'\]\)/);
	assert.match(routeBlock, /await _runNewlyEligibleStage\(stage\)/);
});

test('the full preparation runs when slots arrive, not on every child mutation', () => {
	// Reddit streams children into an existing post throughout hydration, on a
	// vote and on an expando change. Re-decorating for a node that brings no slot
	// re-runs nine selectors and the shadow-part exposure for nothing; a node that
	// brings one genuinely needs it, because that is the title, credit bar and
	// flair appearing.
	assert.match(watcher, /const broughtSlots = root\.matches\('\[slot\]'\) \|\| !!root\.querySelector\('\[slot\]'\);/);
	assert.match(watcher, /if \(broughtSlots\) prepareShredditThing\(owner\);/);
	assert.match(watcher, /else refreshShredditThing\(owner\);/);
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

// The claim the three assertions above cannot make: that a module actually
// subscribes to the route scope, that the observer it registered for one route
// is gone when that route ends, and that the next route gets a live one.
//
// `infiniteScroll`'s current-Reddit limiter is the case. Its observer used to say
// "deliberately for the life of the page", which on a renderer that never unloads
// meant watching the feed the reader scrolled away from while the listing they
// arrived at had none — and a page stage runs once, so it never came back.
test('a route-scoped observer dies with its route and the next route gets a new one', async () => {
	const Modules = await loadModule('lib/core/modules/modules.js', 'route-scope-observer', {
		dom: {
			// No `xmlns`, so `appType()` answers d2x; `routename` is what makes
			// `pageType()` answer `linklist` without guessing from the path.
			url: 'https://www.reddit.com/r/all/',
			html: '<!doctype html><html><body>' +
				'<shreddit-app routename="subreddit"></shreddit-app>' +
				'<shreddit-feed></shreddit-feed>' +
				'</body></html>',
		},
	});

	// Count construction and disconnection rather than reading the source. jsdom
	// gives a real MutationObserver, so this is the observer the module built.
	const live = new Set();
	const Real = globalThis.MutationObserver;
	globalThis.MutationObserver = class extends Real {
		observe(...args) { live.add(this); return super.observe(...args); }
		disconnect(...args) { live.delete(this); return super.disconnect(...args); }
	};

	try {
		const infiniteScroll = Modules.get('infiniteScroll');
		infiniteScroll.options.limitCurrentReddit.value = true;
		infiniteScroll.options.currentRedditLimit.value = '1';

		infiniteScroll.contentStart(new AbortController().signal);
		assert.equal(live.size, 1, 'the limiter arms on the listing it starts on');
		assert.ok(document.querySelector('.rsm-infiniteScroll-limit'), 'and injects its control');

		// Exactly what `init.js` does on `reddit.urlChanged`, in that order: abort
		// the scope the reader is leaving, then let the listeners run.
		Modules._startRouteScope();
		assert.equal(live.size, 0, 'the observer registered for that route is disconnected when it ends');
		assert.equal(document.querySelector('.rsm-infiniteScroll-limit'), null, 'and its control goes with it');

		document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
		assert.equal(live.size, 1, 'the next listing gets a live observer, not the corpse of the last one');
		assert.ok(document.querySelector('.rsm-infiniteScroll-limit'));

		// Twice, because a re-arm that only works once is the same bug later.
		Modules._startRouteScope();
		assert.equal(live.size, 0);
		document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
		assert.equal(live.size, 1);
	} finally {
		globalThis.MutationObserver = Real;
	}
});
