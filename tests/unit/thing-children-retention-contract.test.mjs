// A comment that leaves the page has to be able to leave memory with it.
//
// Every Thing registers itself with its parent, and the parent held those
// references strongly. A parent whose element stays on the page therefore
// accumulated every child Thing ever built under it -- each carrying its
// element, its entry, a `tasks.byId` Map and one closure per registered watcher
// -- for the life of the page. Reddit replaces a comment's replies in place, and
// old Reddit's load-more and collapse cycle detaches and rebuilds them, so on a
// thread the reader keeps working through, that set only grows.
//
// The element map beside it is a WeakMap and always let go. This Set was the one
// thing holding on.

import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { loadModule } from './helpers/loadModule.mjs';

// Collection on demand, without needing `--expose-gc` on the runner's command
// line. "Is this still reachable" is a question only the collector can answer.
v8.setFlagsFromString('--expose_gc');
const collect = vm.runInNewContext('gc');

const HTML = `<!doctype html><html><body>
	<div class="content" role="main">
		<div class="thing comment" id="thing_t1_parent" data-fullname="t1_parent">
			<div class="entry"><a class="author" href="/user/alice">alice</a></div>
			<div class="child" id="replies"></div>
		</div>
	</div>
</body></html>`;

// `loadModule` installs the DOM itself, so the fixture has to go through it --
// installing one first and then loading would hand the module a second, empty
// document and leave this file querying the wrong one.
const { Thing } = await loadModule('lib/utils/Thing.js', 'thing-children-retention', {
	stubEnvironment: true,
	dom: { url: 'https://old.reddit.com/r/example/comments/abc/title/', html: HTML },
});

const replies = document.getElementById('replies');
const parentElement = document.getElementById('thing_t1_parent');

function addReply(id) {
	const element = document.createElement('div');
	element.className = 'thing comment';
	element.id = `thing_t1_${id}`;
	element.dataset.fullname = `t1_${id}`;
	element.innerHTML = '<div class="entry"><a class="author" href="/user/bob">bob</a></div>';
	replies.append(element);
	return element;
}

test('a parent knows its children while they are on the page', () => {
	const parent = Thing.checkedFrom(parentElement);
	const one = Thing.checkedFrom(addReply('one'));
	const two = Thing.checkedFrom(addReply('two'));

	assert.equal(one.parent, parent);
	assert.deepEqual(parent.liveChildren(), [one, two]);

	// The reader of this list is `refreshPartialVisibility`, and it must still see
	// every child that is there.
	assert.equal(parent.liveChildren().length, 2);
});

test('a child that is detached and put back is still a child of its parent', () => {
	// `continueThreadInline` moves comment elements through a DocumentFragment,
	// and `Thing.from` returns the cached Thing rather than re-running the
	// constructor -- so a child dropped from the set while detached would never
	// rejoin its parent, and the parent would quietly stop counting it. Pruning by
	// `isConnected` is exactly that bug.
	const element = addReply('moved');
	const child = Thing.checkedFrom(element);
	assert.ok(parentElement.contains(element));

	const fragment = document.createDocumentFragment();
	fragment.append(element);
	assert.equal(element.isConnected, false);
	assert.ok(parent().liveChildren().includes(child), 'a detached child was dropped while it was still in use');

	replies.append(element);
	assert.ok(parent().liveChildren().includes(child), 'a child that came back is not counted any more');
	element.remove();
});

function parent() {
	return Thing.checkedFrom(parentElement);
}

test('a child the page has thrown away is not kept alive by its parent', async () => {
	const held = parent();
	const probes = [];

	// In a helper so nothing is left on this function's stack when the collector is
	// asked, and with a turn of the loop between each -- a value dropped in the
	// same synchronous run is still live in a register as far as the collector is
	// concerned, and a probe that cannot see a bare detached element go cannot see
	// anything else go either.
	const addAndDrop = index => {
		const element = addReply(`gone${index}`);
		const child = Thing.checkedFrom(element);
		assert.equal(child.parent, held);
		element.remove();
		probes.push(new WeakRef(child));
	};
	for (const index of Array.from({ length: 20 }, (_, at) => at)) {
		addAndDrop(index);
		// eslint-disable-next-line no-await-in-loop
		await new Promise(resolve => { setTimeout(resolve, 1); });
	}

	assert.equal(probes.length, 20);

	for (const _pass of [1, 2, 3, 4, 5, 6]) { // eslint-disable-line no-unused-vars
		collect();
		// eslint-disable-next-line no-await-in-loop
		await new Promise(resolve => { setTimeout(resolve, 10); });
		if (probes.filter(probe => probe.deref()).length <= 1) break;
	}

	const retained = probes.filter(probe => probe.deref()).length;
	assert.ok(retained <= 1, `${retained} of ${probes.length} removed comments are still held by their parent`);

	// The positive control. A probe that reports everything collected proves
	// nothing unless it can also see something that is genuinely held -- and this
	// one is measuring a garbage collector, which is allowed to do nothing at all.
	const pinned = [];
	const pinnedProbes = [];
	for (const index of Array.from({ length: 5 }, (_, at) => at)) {
		const element = addReply(`pinned${index}`);
		const child = Thing.checkedFrom(element);
		pinned.push(child);
		element.remove();
		pinnedProbes.push(new WeakRef(child));
		// eslint-disable-next-line no-await-in-loop
		await new Promise(resolve => { setTimeout(resolve, 1); });
	}
	collect();
	await new Promise(resolve => { setTimeout(resolve, 20); });
	assert.equal(
		pinnedProbes.filter(probe => probe.deref()).length,
		5,
		'the probe reports everything collected even when something is deliberately held; it is measuring nothing',
	);
	assert.equal(pinned.length, 5);

	// And reading the list sweeps what it found dead, so the set does not grow
	// without bound on a thread that rebuilds its replies over and over.
	const alive = held.liveChildren();
	assert.ok(held.children.size <= alive.length + 1, `the set still holds ${held.children.size} entries for ${alive.length} live children`);
});
