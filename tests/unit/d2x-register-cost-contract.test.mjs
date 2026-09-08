// Registering a thread once, rather than once per ancestor.
//
// `registerPage` scans the whole subtree of whatever it is handed, and a
// `shreddit-comment` nests its replies as descendants. Calling it for every
// prepared element therefore registered every comment once for each ancestor it
// had, and the cost compounds with depth: a five-hundred comment thread at
// average depth eight issued about four thousand registrations to register five
// hundred things.
//
// Nothing looked wrong, which is why it lasted. Every watcher is guarded by its
// own WeakSet, so the duplicates were work done and thrown away rather than
// callbacks fired twice. Each one is still a `Thing.checkedFrom`, a
// `getFullname` and a `dupeSet` round trip, on the main thread, while the reader
// waits for the thread to become usable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

// A post, then comments nested four deep with three replies at each level:
// 3 + 9 + 27 + 81 = 120 comments. Depth is the whole point -- a flat feed
// registers correctly either way and would hide this completely.
function thread() {
	const nest = (depth, path) => {
		if (depth > 4) return '';
		const children = [0, 1, 2].map(index => nest(depth + 1, `${path}_${index}`)).join('');
		return `<shreddit-comment thingid="t1_${path}" author="someone" score="1" depth="${depth - 1}">
			<div slot="comment">a comment</div>${children}
		</shreddit-comment>`;
	};
	return `<!doctype html><html><body><shreddit-app>
		<shreddit-post id="t3_post" author="alice" subreddit-name="example" post-type="text"
			permalink="/r/example/comments/post/title/" score="9" comment-count="120">
			<a slot="title" href="/r/example/comments/post/title/">a post</a>
		</shreddit-post>
		${[0, 1, 2].map(index => nest(1, `top${index}`)).join('')}
	</shreddit-app></body></html>`;
}

const Watcher = await loadModule('lib/utils/watchers_d2x.js', 'd2x-register-cost', {
	stubEnvironment: true,
	dom: { url: 'https://www.reddit.com/r/example/comments/post/title/', html: thread() },
	alsoExport: { thing: 'lib/utils/Thing.js', watchers: 'lib/utils/watchers.js' },
});

const { Thing } = Watcher.thing;

test('the initial scan registers each thing once, however deep it sits', async () => {
	const things = new Set(document.querySelectorAll('shreddit-post, shreddit-comment'));
	assert.equal(things.size, 121, 'the fixture is not the thread this test is about');
	assert.ok(document.querySelector('shreddit-comment[depth="3"]'), 'the fixture has no nesting');

	// `Thing.checkedFrom` is the first thing `registerThing` does and nothing else
	// calls it during a scan, so counting it counts registrations.
	const native = Thing.checkedFrom;
	const seen = [];
	Thing.checkedFrom = function checkedFrom(element) {
		seen.push(element);
		return Reflect.apply(native, this, [element]);
	};
	try {
		Watcher.initD2xWatcher();
		// The first scan is deferred by a microtask so contentStart handlers can
		// register their watchers first; the timeout covers that and the observer
		// deliveries it causes.
		await new Promise(resolve => { setTimeout(resolve, 50); });
	} finally {
		Thing.checkedFrom = native;
	}

	const registrations = seen.filter(element => things.has(element));
	assert.ok(registrations.length > 0, 'nothing was registered, so this proves nothing');

	const counts = new Map();
	for (const element of registrations) counts.set(element, (counts.get(element) || 0) + 1);
	const [worstElement, worstCount] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];

	// Two, and the second one is not the shape the comment here used to claim: no
	// module reaches `contentStart` in this test, so `thingWatchers` is empty
	// throughout. It comes from the mutation-driven `register()` that
	// `prepareShredditThing`'s own DOM writes trigger. Whatever its source, two is
	// the ceiling; four thousand was what depth cost.
	assert.ok(
		worstCount <= 2,
		`${worstElement.getAttribute('thingid') || worstElement.id} was registered ${worstCount} times`,
	);
	assert.ok(
		registrations.length <= things.size * 2,
		`${registrations.length} registrations for ${things.size} things`,
	);

	// Every thing is still registered. Registering less is not the fix.
	assert.equal(counts.size, things.size, `${things.size - counts.size} things were never registered`);
});

test('a streamed node with no things in it costs almost nothing', async () => {
	// The other half, and the one the first fix got wrong. Handing the element
	// watchers the whole root rather than each Thing meant every streamed node
	// swept the document for ten selectors, and thing-free nodes are the common
	// shape of churn on a renderer that streams. Registering things once and
	// element watchers per Thing is what keeps both halves cheap.
	const calls = { queries: 0, matches: 0 };
	const root = document.querySelector('shreddit-app');

	const nativeQuery = Element.prototype.querySelectorAll;
	const nativeMatches = Element.prototype.matches;
	Element.prototype.querySelectorAll = function querySelectorAll(...args) {
		calls.queries += 1;
		return Reflect.apply(nativeQuery, this, args);
	};
	Element.prototype.matches = function matches(...args) {
		calls.matches += 1;
		return Reflect.apply(nativeMatches, this, args);
	};

	try {
		for (const _pass of Array.from({ length: 20 }, (_, at) => at)) { // eslint-disable-line no-unused-vars
			const node = document.createElement('div');
			node.className = 'faceplate-tracker';
			node.innerHTML = '<span>nothing a watcher wants</span>';
			root.append(node);
			// eslint-disable-next-line no-await-in-loop
			await new Promise(resolve => { setTimeout(resolve, 0); });
		}
	} finally {
		Element.prototype.querySelectorAll = nativeQuery;
		Element.prototype.matches = nativeMatches;
	}

	// Generous, and still an order of magnitude below sweeping ten page-watcher
	// selectors over the document twenty times.
	assert.ok(calls.queries < 200, `twenty thing-free nodes cost ${calls.queries} subtree queries`);
});

test('a page watcher sees what is inside a Thing, and not the whole document', async () => {
	// The scope the element watchers have always had. Handing them the root
	// instead of each Thing is wider, not narrower, and wider is its own bug: ten
	// page watchers exist, and on a streaming renderer every added node would
	// sweep the document for all ten. It also silently changes which elements ten
	// modules decorate.
	const header = document.createElement('header');
	header.innerHTML = '<time datetime="2026-09-08T00:00:00Z" id="outside">chrome</time>';
	document.body.prepend(header);

	const seen = [];
	Watcher.watchers.watchForElements(['page'], 'time', element => { seen.push(element.id || 'unnamed'); });

	const post = document.createElement('shreddit-post');
	post.id = 't3_late';
	post.setAttribute('author', 'alice');
	post.setAttribute('permalink', '/r/example/comments/late/x/');
	post.innerHTML = '<a slot="title" href="/r/example/comments/late/x/">late</a>' +
		'<time datetime="2026-09-08T00:00:00Z" id="inside">then</time>';
	document.querySelector('shreddit-app').append(post);
	await new Promise(resolve => { setTimeout(resolve, 50); });

	assert.ok(seen.includes('inside'), `the time inside the post was never visited: ${JSON.stringify(seen)}`);
	assert.ok(!seen.includes('outside'), `a page watcher reached outside every Thing: ${JSON.stringify(seen)}`);
	header.remove();
	post.remove();
});

test('a wrapper full of comments registers each of them once', async () => {
	// The owner is an ancestor of the root, so scanning both registers everything
	// under the root twice -- the same bug this file is about, in miniature.
	const host = document.querySelector('shreddit-comment[thingid="t1_top0"]');
	assert.ok(host, 'the fixture changed shape');

	const native = Thing.checkedFrom;
	const seen = [];
	Thing.checkedFrom = function checkedFrom(element) {
		seen.push(element);
		return Reflect.apply(native, this, [element]);
	};
	let wrapper;
	try {
		wrapper = document.createElement('div');
		wrapper.innerHTML = '<shreddit-comment thingid="t1_w1" author="x" score="1" depth="1">' +
			'<div slot="comment">one</div></shreddit-comment>' +
			'<shreddit-comment thingid="t1_w2" author="x" score="1" depth="1">' +
			'<div slot="comment">two</div></shreddit-comment>';
		host.append(wrapper);
		await new Promise(resolve => { setTimeout(resolve, 50); });
	} finally {
		Thing.checkedFrom = native;
	}

	const added = new Set(wrapper.querySelectorAll('shreddit-comment'));
	const counts = new Map();
	for (const element of seen.filter(el => added.has(el))) counts.set(element, (counts.get(element) || 0) + 1);

	assert.equal(counts.size, 2, 'both new comments have to be registered');
	for (const [element, count] of counts) {
		assert.ok(count <= 1, `${element.getAttribute('thingid')} was registered ${count} times by one insertion`);
	}
	wrapper.remove();
});
