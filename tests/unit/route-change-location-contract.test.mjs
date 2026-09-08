// One route change, one answer about where you are.
//
// Six values are memoized per route: the page type, the subreddit, the
// multireddit, the domain, the profile and the quarantine flag. They were
// cleared from a promise callback, which is a microtask after every synchronous
// listener of the same event -- and core's listener is one of those, and it runs
// the `beforeLoad` pass on entry.
//
// So a module whose eligibility had just changed was asked about the route that
// had already been left, while its own `contentStart`, `go` and `afterLoad`,
// past an await, saw the new one. Six consumers read these directly: the four
// `filteReddit` browse cases, `restoreSubCounts` and `commentPreview`.
//
// The second half was the re-arm. A one-shot listener re-registered from inside
// that same microtask cannot see an event dispatched from inside a listener of
// the first, which is exactly what a route change that triggers another one
// looks like.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://www.reddit.com/r/first/', html: '<!doctype html><html><body></body></html>' });

const location_ = await loadFlowModule('lib/utils/currentLocation.js', 'route-change-location', {
	deps: ['lib/utils/functional.js', 'lib/utils/location.js'],
});

function goTo(path) {
	history.pushState({}, '', path);
}

function changeRoute() {
	document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
}

test('a listener registered after the clear sees the route it is on', () => {
	// This is core's shape exactly: a listener added later than
	// `currentLocation`'s own, reading the memos synchronously on entry.
	goTo('/r/first/');
	assert.equal(location_.currentSubreddit(), 'first');

	const seen = [];
	document.addEventListener('reddit.urlChanged', () => {
		seen.push({
			subreddit: location_.currentSubreddit(),
			pageType: location_.pageType(),
			profile: location_.currentUserProfile(),
		});
	});

	goTo('/r/second/');
	changeRoute();

	assert.deepEqual(seen.map(entry => entry.subreddit), ['second'],
		'the listener was told the subreddit it had just left');

	// And the ones nobody thinks about until they are wrong.
	goTo('/user/someone/');
	changeRoute();
	assert.equal(seen[1].subreddit, undefined, 'a profile page still reported a subreddit');
	assert.equal(seen[1].profile, 'someone');

	goTo('/domain/example.com/');
	changeRoute();
	assert.equal(location_.currentDomain(), 'example.com');
	assert.equal(location_.currentUserProfile(), undefined);

	goTo('/me/m/mymulti/');
	changeRoute();
	assert.equal(location_.currentMultireddit(), 'me/m/mymulti');
});

test('a second route change dispatched from inside the first is not dropped', () => {
	// Reddit's own navigation can settle in two steps, and our watcher dispatches
	// on more than one signal, so a second event arriving from inside a listener
	// of the first is ordinary rather than exotic. A one-shot re-armed from a
	// microtask never saw it, and every memo stayed on the route two changes ago.
	goTo('/r/alpha/');
	changeRoute();
	assert.equal(location_.currentSubreddit(), 'alpha');

	let armed = true;
	const cascade = () => {
		if (!armed) return;
		armed = false;
		goTo('/r/omega/');
		changeRoute();
	};
	document.addEventListener('reddit.urlChanged', cascade);

	goTo('/r/beta/');
	changeRoute();

	document.removeEventListener('reddit.urlChanged', cascade);
	assert.equal(location_.currentSubreddit(), 'omega',
		'the second change in one turn left the memos on an earlier route');
});

test('clearing is one call, and it clears everything that is memoized per route', () => {
	location_.clearLocationCaches();
	goTo('/r/before/');
	assert.equal(location_.currentSubreddit(), 'before');
	assert.equal(location_.currentDomain(), undefined);

	goTo('/domain/example.org/');
	// Stale on purpose: nothing has told it the route moved.
	assert.equal(location_.currentSubreddit(), 'before');

	location_.clearLocationCaches();
	assert.equal(location_.currentSubreddit(), undefined);
	assert.equal(location_.currentDomain(), 'example.org');
	assert.equal(location_.currentMultireddit(), undefined);
	assert.equal(location_.currentUserProfile(), undefined);

	// The quarantine flag is read off the body, so it goes stale without the path
	// changing at all -- which is why it belongs in the same clear as the five
	// that are derived from the path.
	document.body.classList.add('quarantine');
	assert.equal(location_.inQuarantinedSubreddit(), true);
	document.body.classList.remove('quarantine');
	assert.equal(location_.inQuarantinedSubreddit(), true, 'nothing has cleared it yet');
	location_.clearLocationCaches();
	assert.equal(location_.inQuarantinedSubreddit(), false);
});

test('a memo added later is a memo this clears', () => {
	// The list is what rots. A seventh value memoized in this module and cleared
	// nowhere is the same bug again, quietly, so the count is pinned rather than
	// left to whoever adds it.
	const source = codeOnly(readRepoFile('lib/utils/currentLocation.js'));
	const memoized = [...source.matchAll(/export const (\w+) = memoize(?:Unsettled)?\(/g)].map(match => match[1]);
	const clearBody = source.slice(source.indexOf('export function clearLocationCaches'), source.indexOf('document.addEventListener'));
	const cleared = [...clearBody.matchAll(/(\w+)\.cache\.clear\(\)/g)].map(match => match[1]);

	assert.ok(memoized.length >= 5, `only ${memoized.length} memoized exports were found; the scan is not reading the module`);
	assert.deepEqual(
		[...memoized].sort(),
		[...cleared].sort(),
		'a value memoized per route is not cleared when the route changes',
	);
});
