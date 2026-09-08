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
	alsoExport: { thing: 'lib/utils/Thing.js' },
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

	// Two is the documented shape: once while the page is registered, when no
	// module has reached contentStart and `thingWatchers` is still empty, and
	// again once they have. Anything past that is depth being paid for.
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
