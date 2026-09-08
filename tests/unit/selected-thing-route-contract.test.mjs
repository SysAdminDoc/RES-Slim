// What happens to the selection when the route changes under it.
//
// Old Reddit loads a document per route, so every module-level reference in
// `selectedThing.js` was discarded for free. Current Reddit does not: a listing
// to post to listing trip is one document, and nothing in this file listened for
// `reddit.urlChanged`. Three things followed from that.
//
//   * `current` still pointed at the first route's Thing, and the auto-select
//     watcher returns early while `current` is set. The second route never got a
//     selection, so keyboard navigation and the comment navigator had no anchor.
//   * `lastSelectedKey` interpolated `location.pathname` once, at import. Every
//     later route persisted its selection under the first route's key and read
//     the first route's remembered id back.
//   * `current`, `previous` and `currentContainer` held the old route's detached
//     subtree for the rest of the session.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://www.reddit.com/r/first/' });

// One bundle, not two. `selectedThing` registers its watcher callbacks against
// the `watchers` module it imports, so loading the two separately gives each its
// own registry and `registerPage` reaches a watcher list nobody is listening to.
const utils = await loadModule('lib/utils/index.js', 'selected-thing-route');
const { registerPage, SelectedThing: selectedThing } = utils;

// Old-Reddit shaped, because `Thing` recognises that markup on either host and
// this contract is about route lifetime, not about markup detection.
function post(fullname) {
	const element = document.createElement('div');
	element.className = 'thing link';
	element.id = `thing_${fullname}`;
	element.setAttribute('data-fullname', fullname);
	element.innerHTML = '<div class="entry"><p class="title"><a class="title" href="/r/x/comments/a/b/">t</a></p></div>';
	return element;
}

function route(pathname) {
	const feed = document.createElement('shreddit-feed');
	document.body.replaceChildren(feed);
	history.pushState({}, '', pathname);
	return feed;
}

function show(container, fullname) {
	const element = post(fullname);
	container.append(element);
	registerPage(container);
	return element;
}

const KEY_PREFIX = 'RES.lastSelectedEntry';
const storedKeys = () => Object.keys(sessionStorage).filter(key => key.startsWith(KEY_PREFIX));

test('a route change releases the selection so the next route can take one', () => {
	const first = route('/r/first/');
	const a = show(first, 't3_aaaaaaa');
	assert.equal(selectedThing.current && selectedThing.current.element, a, 'the first route selects its first post');
	assert.ok(a.classList.contains('res-selected'), 'and marks it');

	// The navigation itself. Reddit dispatches this on its own soft navigations,
	// and `core/init.js` and four other modules already listen for it.
	const second = route('/r/second/');
	document.dispatchEvent(new CustomEvent('reddit.urlChanged'));

	assert.equal(selectedThing.current, null, 'the previous route must not keep the selection');
	assert.equal(a.classList.contains('res-selected'), false, 'and must not keep the marker either');

	const b = show(second, 't3_bbbbbbb');
	assert.equal(selectedThing.current && selectedThing.current.element, b, 'the new route gets its own selection');
});

// The persist listener runs `beforePaint`, so it lands a frame or two after the
// selection. Polled rather than assumed, because a fixed number of frames is a
// guess about the throttle's internals.
async function settle(predicate, what) {
	let attempts = 40;
	while (attempts > 0) {
		if (predicate()) return;
		attempts -= 1;
		// eslint-disable-next-line no-await-in-loop
		await new Promise(resolve => { requestAnimationFrame(resolve); });
	}
	assert.fail(`${what}; stored ${JSON.stringify(storedKeys())}`);
}

test('each route remembers its own selection, under its own key', async () => {
	sessionStorage.clear();

	// The previous test left a selection behind, exactly as a real route change
	// does; releasing it is the precondition for the new route selecting anything
	// at all, which is the other half of this file.
	const first = route('/r/alpha/');
	document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
	show(first, 't3_alpha01');
	await settle(() => sessionStorage[`${KEY_PREFIX}-/r/alpha/`] === 't3_alpha01', 'alpha never persisted its selection');

	const second = route('/r/beta/');
	document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
	show(second, 't3_beta001');
	await settle(() => sessionStorage[`${KEY_PREFIX}-/r/beta/`] === 't3_beta001', 'beta never persisted under its own key');

	// Two keys, not one overwritten twice. The key frozen at import wrote beta's
	// selection into alpha's slot, and read alpha's id back when beta loaded.
	assert.deepEqual(storedKeys().sort(), [`${KEY_PREFIX}-/r/alpha/`, `${KEY_PREFIX}-/r/beta/`].sort());
	assert.equal(sessionStorage[`${KEY_PREFIX}-/r/alpha/`], 't3_alpha01', 'alpha’s selection has to survive beta');
});

function comment(fullname) {
	const element = document.createElement('div');
	element.className = 'thing comment';
	element.id = `thing_${fullname}`;
	element.setAttribute('data-fullname', fullname);
	element.innerHTML = '<div class="entry"><p class="tagline"><a class="author" href="/user/x">x</a></p></div>';
	return element;
}

test('a comment streamed into another tree does not steal the selection', async () => {
	// This is what `currentContainer` exists for. When the selected thing leaves
	// the document -- reddit re-renders the tree it was in -- the watcher selects
	// the first comment that arrives afterwards, but only from the same subtree.
	// The container was resolved with `.sitetable` alone, which never matches on
	// current Reddit, so `currentContainer` was null there and the guard was
	// skipped: a comment streaming into any tree took the selection.
	//
	// Old-Reddit comment markup inside current-Reddit containers, because `Thing`
	// detects a comment by its class on either host and what is under test here is
	// which ancestor counts as the container.
	sessionStorage.clear();
	const page = document.createElement('div');
	document.body.replaceChildren(page);
	const mine = document.createElement('shreddit-comment-tree');
	const other = document.createElement('shreddit-comment-tree');
	page.append(mine, other);
	history.pushState({}, '', '/r/containers/comments/a/b/');
	document.dispatchEvent(new CustomEvent('reddit.urlChanged'));

	const first = comment('t1_mine001');
	mine.append(first);
	registerPage(mine);
	assert.equal(selectedThing.current && selectedThing.current.element, first, 'the tree has to hold the selection first');

	// Reddit re-renders the subtree the selection was in.
	first.remove();
	// Past the watcher's 100ms leading throttle, or the next registration is
	// swallowed and the assertion passes without the guard doing anything.
	await new Promise(resolve => { setTimeout(resolve, 150); });

	const stranger = comment('t1_other01');
	other.append(stranger);
	registerPage(other);
	assert.notEqual(selectedThing.current && selectedThing.current.element, stranger,
		'a comment in a different tree must not take the selection');

	await new Promise(resolve => { setTimeout(resolve, 150); });
	const replacement = comment('t1_mine002');
	mine.append(replacement);
	registerPage(mine);
	assert.equal(selectedThing.current && selectedThing.current.element, replacement,
		'and one in the same tree must, or the guard has simply broken the feature');
});
