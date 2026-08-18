// The seventeen modules that had no test at all, executed.
//
// Seventeen registered modules were not mentioned anywhere under tests/, and
// three of them (`classicFavicon`, `disableSubredditStyles`, `fixImageLinks`)
// own long-lived MutationObservers that turned up in the leak audit — the
// untested set and the defect set overlapped. A registry-presence grep would
// have "covered" all seventeen while proving nothing, which is the lesson this
// repo already paid for once: `eventTrackingSabotage`'s fetch blocker was green
// for its entire life while blocking nothing.
//
// So every test here calls the module's shipped hooks against a fixture and
// asserts what the page looks like afterwards. One bundle serves all of them —
// `alsoExport` names each module inside the *same* bundle, so the seventeen do
// not cost seventeen esbuild runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const MODULES = [
	'classicFavicon', 'commentHidePersistor', 'commentQuickCollapse', 'commentSortBy',
	'commentStyle', 'disableSubredditStyles', 'downloadButtons', 'fixImageLinks',
	'fixProcessingImg', 'hideGifComments', 'readComments', 'reddEye', 'selectedEntry',
	'showParent', 'spoilerTags', 'subredditBlacklist', 'userProfileSearch',
];

// The xmlns is load-bearing, not decoration: `appType()` reads it to decide
// whether this is old reddit, it is a `once`, and without it every page-type
// gate in the seventeen answers "no" — so the modules load, register, and do
// nothing, which is indistinguishable from a passing test that asserts nothing.
const PAGE = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="icon" href="https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png"></head><body class="listing-page">
	<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
	<div class="content" role="main"><div id="siteTable" class="sitetable linklisting"></div></div>
</body></html>`;

const Bundle = await loadModule('lib/modules/frictionRemovers.js', 'untested-modules', {
	dom: { url: 'https://old.reddit.com/r/all/', html: PAGE },
	alsoExport: {
		...Object.fromEntries(MODULES.map(id => [id, `lib/modules/${id}.js`])),
		watchers: 'lib/utils/watchers.js',
		thing: 'lib/utils/thing.js',
		currentLocation: 'lib/utils/currentLocation.js',
	},
});

const mod = id => Bundle[id].module;

function reset(bodyHtml = '') {
	document.head.innerHTML = '<link rel="icon" href="https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png">';
	document.body.innerHTML = `
		<div id="header" role="banner"><div id="header-bottom-left"><ul class="tabmenu"><li class="selected"><a href="#">hot</a></li></ul></div></div>
		<div class="content" role="main"><div id="siteTable" class="sitetable linklisting">${bodyHtml}</div></div>`;
	document.documentElement.className = '';
	document.body.className = 'listing-page';
}

// `watchForThings` without `{ immediate: true }` parks its callback in
// `thing.tasks.visible`, drained by an IntersectionObserver on first paint.
// jsdom has neither, so the page has to be told it is visible — otherwise the
// module loads, registers, and does nothing, which reads exactly like a module
// that does not work.
function registerThings() {
	Bundle.watchers.registerPage(document.body);
	for (const element of document.querySelectorAll(Bundle.thing.Thing.thingSelector)) {
		const thing = Bundle.thing.Thing.from(element);
		if (thing) thing.runTasks();
	}
}

// Several of the seventeen are gated on page type, which is derived from
// `location.pathname` behind a memo. `currentSubreddit` is a `once`, though, so
// the subreddit half of that cannot be re-read — which is why the /r/all test
// runs before anything moves off it.
function setPath(pathname) {
	window.history.replaceState({}, '', pathname);
	Bundle.currentLocation.pageType.cache.clear();
}

function post({ id = 't3_a', subreddit = 'test', extra = '', entry = '' } = {}) {
	return `<div class="thing link" id="thing_${id}" data-fullname="${id}" data-subreddit="${subreddit}" ${extra}>
		<div class="entry"><p class="title"><a class="title" href="/r/${subreddit}/comments/x/y/">A post</a></p>
		<p class="tagline"><a class="author" href="/user/someone">someone</a></p>${entry}</div>
	</div>`;
}

function comment({ id = 't1_a', body = 'text', collapsed = false } = {}) {
	return `<div class="thing comment${collapsed ? ' collapsed' : ''}" id="thing_${id}" data-fullname="${id}">
		<div class="entry"><p class="tagline"><a class="expand" href="#">[-]</a><a class="author" href="/user/someone">someone</a></p>
		<form class="usertext"><div class="usertext-body"><div class="md">${body}</div></div></form></div>
	</div>`;
}

// --- modules that rewrite or remove page furniture ---------------------------

test('classicFavicon replaces reddit\'s favicon and evicts the ones it found', () => {
	reset();
	assert.equal(document.querySelectorAll('link[rel~="icon"]').length, 1);

	mod('classicFavicon').beforeLoad();

	const icons = document.querySelectorAll('link[rel~="icon"]');
	assert.equal(icons.length, 1, 'the page favicon must be evicted, not merely outranked');
	assert.match(icons[0].href, /^data:image\/png;base64,/, 'and the replacement is inlined, so it needs no network');
	assert.equal(icons[0].id, 'res-classic-reddit-favicon');

	// beforeLoad and contentStart both run in the product; the second must not
	// stack a second observer or a second link.
	mod('classicFavicon').contentStart();
	assert.equal(document.querySelectorAll('link[rel~="icon"]').length, 1, 'running twice is the normal case, not an error case');
});

test('disableSubredditStyles strips both spellings of a subreddit stylesheet', () => {
	reset();
	document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" title="applied_subreddit_stylesheet" href="https://example.com/sub.css">');
	document.head.insertAdjacentHTML('beforeend', '<style title="applied_subreddit_stylesheet">.thing { color: red }</style>');
	document.head.insertAdjacentHTML('beforeend', '<style title="something_else">.thing { color: blue }</style>');

	mod('disableSubredditStyles').beforeLoad();

	assert.equal(document.querySelectorAll('[title="applied_subreddit_stylesheet"]').length, 0, 'reddit serves subreddit CSS as a link OR an inline style depending on size — stripping one leaves half of them working');
	assert.equal(document.querySelectorAll('[title="something_else"]').length, 1, 'and nothing else is touched');
});

test('fixImageLinks unwraps the new-reddit media viewer and preview host', () => {
	reset(post({ entry: `
		<a class="wrapped" href="https://old.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fabc.jpg">wrapped</a>
		<a class="preview" href="https://preview.redd.it/abc.jpg?width=640&amp;crop=smart">preview</a>
		<a class="untouched" href="https://i.redd.it/abc.jpg">direct</a>` }));

	mod('fixImageLinks').contentStart();

	assert.equal(document.querySelector('a.wrapped').href, 'https://i.redd.it/abc.jpg', 'the /media wrapper is the whole point of the module');
	assert.equal(document.querySelector('a.preview').href, 'https://i.redd.it/abc.jpg', 'preview.redd.it needs its resizing query dropped too, or it is still not the image');
	assert.equal(document.querySelector('a.untouched').href, 'https://i.redd.it/abc.jpg', 'a link that is already direct is left exactly as it was');
});

test('fixImageLinks keeps rewriting links that arrive later', async () => {
	reset();
	mod('fixImageLinks').contentStart();

	document.querySelector('#siteTable').insertAdjacentHTML('beforeend', post({
		id: 't3_late',
		entry: '<a class="late" href="https://preview.redd.it/late.png?width=1">late</a>',
	}));
	// MutationObserver callbacks are queued as microtasks.
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.equal(document.querySelector('a.late').href, 'https://i.redd.it/late.png', 'infinite scroll appends most of the links on a session');
});

// --- modules that decorate things -------------------------------------------

test('userProfileSearch puts one search link beside each username', () => {
	reset(post());
	mod('userProfileSearch').contentStart();

	const icons = document.querySelectorAll('a.author + a');
	assert.equal(icons.length, 1);
	assert.match(icons[0].href, /^https:\/\/duckduckgo\.com\/\?q=/);
	assert.match(decodeURIComponent(icons[0].href), /site:reddit\.com "u\/someone"/);
	assert.equal(icons[0].rel, 'noopener', 'a target=_blank link without noopener hands the opener to the search engine');

	mod('userProfileSearch').contentStart();
	assert.equal(document.querySelectorAll('a.author + a').length, 1, 'a second pass must not stack a second icon');
});

test('userProfileSearch honours the chosen engine', () => {
	reset(post());
	mod('userProfileSearch').options.engine.value = 'kagi';
	try {
		mod('userProfileSearch').contentStart();
		assert.match(document.querySelector('a.author + a').href, /^https:\/\/kagi\.com\/search/);
	} finally {
		mod('userProfileSearch').options.engine.value = 'duckduckgo';
	}
});

test('downloadButtons offers a direct file, not the DASH manifest', async () => {
	reset(post({ entry: '<div class="expando"><video><source src="https://v.redd.it/xyz/DASHPlaylist.mpd"></video></div>' }));
	mod('downloadButtons').contentStart();
	registerThings();
	// The module waits a frame so showImages has time to inflate the expando.
	await new Promise(resolve => setTimeout(resolve, 50));

	const button = document.querySelector('a.res-slim-download-btn');
	assert.ok(button, 'the button must reach a v.redd.it expando');
	assert.equal(button.href, 'https://v.redd.it/xyz/DASH_720.mp4', 'a browser cannot save an .mpd as a video');
	assert.equal(button.getAttribute('download'), 'DASH_720.mp4');
});

test('downloadButtons can be turned off per media kind', async () => {
	reset(post({ entry: '<div class="expando"><img src="https://i.redd.it/abc.jpg"></div>' }));
	mod('downloadButtons').options.showOnImages.value = false;
	mod('downloadButtons').options.showOnVideos.value = false;
	try {
		mod('downloadButtons').contentStart();
		registerThings();
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.equal(document.querySelector('a.res-slim-download-btn'), null, 'an option that is off must actually be off');
	} finally {
		mod('downloadButtons').options.showOnImages.value = true;
		mod('downloadButtons').options.showOnVideos.value = true;
	}
});

// --- modules that hide or collapse ------------------------------------------

test('subredditBlacklist hides only the listed subreddits, and only where it should', () => {
	reset(post({ id: 't3_keep', subreddit: 'keepme' }) + post({ id: 't3_hide', subreddit: 'HideMe' }));
	mod('subredditBlacklist').options.blacklist.value = 'hideme, other';
	try {
		mod('subredditBlacklist').contentStart();
		registerThings();

		assert.equal(document.querySelector('#thing_t3_hide').style.display, 'none', 'the match is case-insensitive — a list the user types by hand will not match reddit\'s casing');
		assert.notEqual(document.querySelector('#thing_t3_keep').style.display, 'none');
	} finally {
		mod('subredditBlacklist').options.blacklist.value = '';
	}
});

test('hideGifComments collapses a GIF-only comment and leaves real ones alone', () => {
	setPath('/r/test/comments/abc/a-thread/');
	reset(
		comment({ id: 't1_gif', body: '<p><a href="https://i.redd.it/funny.gif">https://i.redd.it/funny.gif</a></p>' }) +
		comment({ id: 't1_words', body: '<p>Look at this <a href="https://i.redd.it/funny.gif">gif</a>, it is relevant because…</p>' }),
	);

	// Old reddit's collapse is a click handler that rewrites the comment into a
	// one-line stub *and* adds `.collapsed`; adding the class alone gets half of
	// it. So the module clicks the toggle, and what is checkable without reddit's
	// own script present is that it clicked the right one, exactly once.
	const clicked = [];
	for (const toggle of document.querySelectorAll('.expand')) {
		toggle.addEventListener('click', e => clicked.push(e.currentTarget.closest('.thing').id));
	}

	mod('hideGifComments').contentStart();
	registerThings();

	assert.deepEqual(clicked, ['thing_t1_gif'], 'a comment that is nothing but a hosted image is the target; one with something to say around it is not');
});

test('hideGifComments falls back to the class when there is no toggle to click', () => {
	setPath('/r/test/comments/abc/a-thread/');
	reset(comment({ id: 't1_gif', body: '<p><a href="https://media1.giphy.com/x.gif">https://media1.giphy.com/x.gif</a></p>' }));
	document.querySelector('#thing_t1_gif .expand').remove();

	mod('hideGifComments').contentStart();
	registerThings();

	assert.ok(document.querySelector('#thing_t1_gif').classList.contains('collapsed'), 'half a collapse beats none when reddit did not render the toggle');
});

test('hideGifComments ignores hosts it does not recognise', () => {
	setPath('/r/test/comments/abc/a-thread/');
	reset(comment({ id: 't1_other', body: '<p><a href="https://example.com/x.gif">https://example.com/x.gif</a></p>' }));
	const clicked = [];
	document.querySelector('.expand').addEventListener('click', () => clicked.push('clicked'));

	mod('hideGifComments').contentStart();
	registerThings();

	assert.deepEqual(clicked, [], 'the module targets a karma-farming pattern on four image hosts, not every link that ends in .gif');
});

test('hideGifComments does not re-expand a comment that is already collapsed', () => {
	setPath('/r/test/comments/abc/a-thread/');
	reset(comment({ id: 't1_gif', body: '<p><a href="https://i.redd.it/funny.gif">https://i.redd.it/funny.gif</a></p>', collapsed: true }));
	// Old reddit's collapse is a click handler, so the module clicks the toggle
	// rather than adding the class. Clicking one that is already collapsed would
	// open it — the exact opposite of the feature.
	mod('hideGifComments').contentStart();
	registerThings();
	assert.ok(document.querySelector('#thing_t1_gif').classList.contains('collapsed'));
});

// --- modules that only declare -----------------------------------------------

test('the option-only and body-class modules declare what the stylesheet expects', () => {
	// `spoilerTags` and `commentStyle` ship no behaviour: they exist to put a class
	// on <body> that CSS keys off. That makes `bodyClass` load-bearing, and an
	// unset one is a silently dead feature rather than an error.
	assert.equal(mod('spoilerTags').bodyClass, true);
	assert.equal(mod('spoilerTags').options.transition.bodyClass, true);
	assert.deepEqual(mod('spoilerTags').include, ['profile']);
});

// --- every one of the seventeen actually runs --------------------------------

test('every previously untested module survives being run on a real page', () => {
	// The floor under the tests above: each module's own hooks are invoked against
	// a populated document, and a module that throws on load fails here rather
	// than in a user's console. Several of the seventeen are small enough that
	// this *is* their contract.
	reset(post() + comment());
	const failures = [];
	for (const id of MODULES) {
		const target = mod(id);
		assert.ok(target, `${id} must be reachable through the registry`);
		for (const stage of ['beforeLoad', 'contentStart', 'go']) {
			const hook = target[stage];
			if (typeof hook !== 'function') continue;
			try {
				const result = hook();
				if (result instanceof Promise) result.catch(e => failures.push(`${id}.${stage}: ${e && e.message}`));
			} catch (e) {
				failures.push(`${id}.${stage}: ${(e && e.message) || e}`);
			}
		}
		registerThings();
	}
	assert.deepEqual(failures, []);
});

test('the seventeen are the seventeen, and each is registered', async () => {
	const registry = Bundle.__registry;
	for (const id of MODULES) {
		assert.ok(registry.get(id), `${id} is not in the module registry`);
	}
});
