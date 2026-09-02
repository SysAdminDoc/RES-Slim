// A post can have no link, and asking for one has to say so.
//
// `Thing.getPostLink()` was typed `HTMLAnchorElement` and returned
// `downcast(querySelector(...) || querySelector(...), HTMLAnchorElement)`.
// `downcast` only checks in a development build, so the two builds behaved
// differently on the same page: development threw "Expected null to be instance
// of…" from inside a watcher callback, and production returned the null.
// `showImages` then called `checkElementForMedia(null)`, which dereferences its
// argument, so every such post produced an uncaught
// `TypeError: can't access property "closest", e is null`.
//
// It is not a hypothetical shape. Current reddit streams a `shreddit-post`
// element before the title arrives in its slot, and a text-only combined-search
// result exposes `search-title` but neither `a.title` nor `a.search-link`
// (upstream #5564). Found by the Firefox audit on 2026-09-02, which is the only
// thing in this repo that drives a *production* bundle in a browser.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule, installDom } from './helpers/loadModule.mjs';
import { readRepoFile } from './helpers/loadFlowModule.mjs';

const { Thing } = await loadModule('lib/utils/Thing.js', 'post-link');

function makePost(inner) {
	document.body.innerHTML = `<div id="siteTable"><div class="thing link" data-fullname="t3_abc1234">
		<div class="entry">${inner}</div>
	</div></div>`;
	return Thing.from(document.querySelector('.thing'));
}

// What each half proves. The three value cases below pass against the old code
// too, and that is the point rather than a gap: outside a development build
// `downcast` was already returning the null, so the value was never the defect -
// the type saying it could not be null was, and the caller that believed it. The
// two source assertions at the end are what go red if either comes back, and the
// Firefox audit is what caught it, because it drives a production bundle.
test('a post with a title link hands it back', () => {
	installDom({ url: 'https://old.reddit.com/r/example/' });
	const thing = makePost('<a class="title" href="https://example.com/story">A story</a>');
	const link = thing.getPostLink();
	assert.ok(link, 'the ordinary case must still work');
	assert.equal(link.href, 'https://example.com/story');
	assert.equal(thing.getPostUrl(), 'https://example.com/story');
});

test('a post with no link at all answers null rather than throwing or lying', () => {
	installDom({ url: 'https://old.reddit.com/r/example/' });
	const thing = makePost('<span class="title">A title with no anchor yet</span>');
	assert.equal(thing.getPostLink(), null);
	assert.equal(thing.getPostUrl(), '', 'and the URL derived from it is empty, not a crash');
});

test('the search fallback is still reached', () => {
	installDom({ url: 'https://old.reddit.com/search/' });
	const thing = makePost('<a class="search-title" href="https://example.com/result">A result</a>');
	assert.equal(thing.getPostLink().href, 'https://example.com/result');
});

test('showImages does not hand a missing link to the media scanner', () => {
	// The call site is what turned a null into an uncaught error, and it is one
	// line inside a `watchForThings` callback that no unit test can reach without
	// the whole module runtime - so this is asserted as source shape, with the
	// behaviour above covering the value it is guarding.
	const source = readRepoFile('lib/modules/showImages.js');
	assert.match(source, /const link = thing\.getPostLink\(\);/);
	assert.match(source, /return link \? checkElementForMedia\(link\) : undefined;/);
	assert.doesNotMatch(source, /checkElementForMedia\(thing\.getPostLink\(\)\)/);
});

test('getPostLink is typed as nullable, so a caller has to deal with it', () => {
	const source = readRepoFile('lib/utils/Thing.js');
	assert.match(source, /getPostLink\(\): \?HTMLAnchorElement \{/);
	// `downcast` skips its check in production, so it cannot be what stands
	// between a null and a caller.
	assert.doesNotMatch(source, /getPostLink[\s\S]{0,400}?downcast\(/);
});
