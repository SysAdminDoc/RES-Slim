// Duplicate-post removal, executed against real fullnames.
//
// `registerThing` removed a repeated post only when `thing.getFullname().length
// === 9`, with the comment "valid ids have 9 characters". That was true when it
// was written: reddit's base-36 id counter was five characters wide, so `t3_` +
// five gave eight and six gave nine. The counter has since reached seven, so
// every post made in the last few years produces a ten-character fullname and
// fell straight past the check. Infinite scroll re-rendered posts it had already
// shown, and nothing noticed, because the repo's own fixtures use ids like
// `t3_post00000001` - fifteen characters - so the removal path was never
// exercised by a test either.
//
// The nesting case below is the reason this is not simply a wider length check:
// `continueThreadInline` replaces a "continue this thread" link with the comment
// subtree it fetched, which is rooted at a comment already on the page. Treating
// that as a duplicate deletes what the user just asked to load.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/' });

const watchers = await loadModule('lib/utils/watchers.js', 'thing-dedupe');

function post(fullname) {
	const element = document.createElement('div');
	element.className = 'thing link';
	element.id = `thing_${fullname}`;
	element.setAttribute('data-fullname', fullname);
	element.innerHTML = '<div class="entry"><p class="title"><a class="title" href="/r/example/comments/x/y/">t</a></p></div>';
	return element;
}

function registerAll(root) {
	watchers.registerPage(root);
}

test('a modern seven-character id is deduplicated', () => {
	// `t3_` + seven characters = ten, which the old `length === 9` test missed.
	const listing = document.createElement('div');
	document.body.append(listing);

	const first = post('t3_1ul533q');
	listing.append(first);
	registerAll(listing);

	const second = post('t3_1ul533q');
	listing.append(second);
	registerAll(second);

	assert.equal(second.isConnected, false, 'the repeat should have been removed');
	assert.equal(first.isConnected, true, 'the original must stay');
	listing.remove();
});

test('the historical five and six character ids still work', () => {
	for (const fullname of ['t3_abcde', 't3_abcdef', 't1_ab12c']) {
		const listing = document.createElement('div');
		document.body.append(listing);

		const first = post(fullname);
		listing.append(first);
		registerAll(listing);

		const second = post(fullname);
		listing.append(second);
		registerAll(second);

		assert.equal(second.isConnected, false, `${fullname} should have been deduplicated`);
		listing.remove();
	}
});

test('two different posts are both kept', () => {
	const listing = document.createElement('div');
	document.body.append(listing);

	const a = post('t3_1ul533q');
	const b = post('t3_1ul533r');
	listing.append(a, b);
	registerAll(listing);

	assert.equal(a.isConnected, true);
	assert.equal(b.isConnected, true);
	listing.remove();
});

test('a placeholder with no id is left alone', () => {
	const listing = document.createElement('div');
	document.body.append(listing);

	const first = post('');
	first.removeAttribute('data-fullname');
	first.removeAttribute('id');
	const second = post('');
	second.removeAttribute('data-fullname');
	second.removeAttribute('id');
	listing.append(first, second);
	registerAll(listing);

	assert.equal(first.isConnected, true);
	assert.equal(second.isConnected, true, 'two id-less placeholders are not duplicates of each other');
	listing.remove();
});

test('a copy spliced inside its own original is a continuation, not a duplicate', () => {
	// What continueThreadInline produces: the fetched subtree is rooted at the
	// comment that carried the "continue this thread" link, and it is inserted
	// underneath that same comment. Removing it would delete the load.
	const listing = document.createElement('div');
	document.body.append(listing);

	const original = post('t3_1ul533q');
	listing.append(original);
	registerAll(listing);

	const child = document.createElement('div');
	child.className = 'child';
	original.append(child);
	const spliced = post('t3_1ul533q');
	child.append(spliced);
	registerAll(spliced);

	assert.equal(spliced.isConnected, true, 'a nested copy must survive');
	assert.equal(original.isConnected, true);
	listing.remove();
});

test('a repeat whose original has already left the document is kept', () => {
	const listing = document.createElement('div');
	document.body.append(listing);

	const first = post('t3_1ul999z');
	listing.append(first);
	registerAll(listing);
	first.remove();

	const second = post('t3_1ul999z');
	listing.append(second);
	registerAll(second);

	assert.equal(second.isConnected, true, 'nothing on the page is showing this post any more');
	listing.remove();
});

test('an SPA route change clears the map rather than growing it forever', () => {
	// Current Reddit replaces the whole feed without a reload. The map keyed
	// fullname to element and was never pruned, so it grew without bound and
	// pinned every element of every feed the session had rendered. Clearing is
	// also correct on its own terms: the next page legitimately shows a post the
	// previous one did.
	// The old feed is left attached on purpose. That is the case the stale entry
	// gets wrong: with the map still holding it, the post rendered by the *new*
	// route is deleted as a duplicate of the one the previous route showed.
	const first = document.createElement('div');
	document.body.append(first);
	const a = post('t3_1ul777a');
	first.append(a);
	registerAll(first);

	document.dispatchEvent(new Event('reddit.urlChanged'));

	const second = document.createElement('div');
	document.body.append(second);
	const b = post('t3_1ul777a');
	second.append(b);
	registerAll(second);

	assert.equal(b.isConnected, true, 'a post on the next page is not a duplicate of one on the last');
	first.remove();
	second.remove();
});
