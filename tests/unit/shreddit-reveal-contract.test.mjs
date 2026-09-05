import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const reveal = await loadFlowModule('lib/utils/shredditReveal.js', 'shreddit-reveal');
const { REVEAL_TARGETS, BLUR_CLASS, BLUR_CLASS_TAG, wants, patchPrototype, installReveal } = reveal;

const entry = readRepoFile('lib/pageWorld/shredditReveal.entry.js');
const mod = readRepoFile('lib/modules/nsfwThumbnails.js');

// A registry shaped like `customElements`, holding prototypes a test can call.
function fakeRegistry(defined) {
	return {
		whenDefined: tag => (Object.hasOwn(defined, tag) ?
			Promise.resolve(defined[tag]) :
			// A tag the page never defines never resolves in a browser either. The
			// rejection here is what lets a test finish; `patchPrototype` swallows it.
			Promise.reject(new Error(`never defined: ${tag}`))),
	};
}

function elementClass(method = 'render') {
	const calls = [];
	class Fake {
		constructor() { this.reason = undefined; }
	}
	Fake.prototype[method] = function(...args) { calls.push([this, args]); return 'rendered'; };
	return { Fake, calls };
}

test('a blur is only revealed for the toggle the reader turned on', () => {
	assert.equal(wants('nsfw', undefined, { nsfw: true, spoiler: false }), true);
	assert.equal(wants('nsfw', undefined, { nsfw: false, spoiler: true }), false);
	assert.equal(wants('spoiler', undefined, { nsfw: true, spoiler: false }), false);
	assert.equal(wants('spoiler', undefined, { nsfw: false, spoiler: true }), true);

	// The element that serves both carries its own reason.
	assert.equal(wants('reason', 'nsfw', { nsfw: true, spoiler: false }), true);
	assert.equal(wants('reason', 'spoiler', { nsfw: true, spoiler: false }), false);
	assert.equal(wants('reason', 'spoiler', { nsfw: false, spoiler: true }), true);

	// An unrecognised reason stays blurred. Revealing on a value this does not
	// know is the failure that shows somebody something they did not ask for, so
	// the default has to be "leave it alone" rather than "assume nsfw".
	assert.equal(wants('reason', 'something-new', { nsfw: true, spoiler: true }), false);
	assert.equal(wants('reason', undefined, { nsfw: true, spoiler: true }), false);
});

test('patching a prototype runs the hook first and still returns what the method returned', async () => {
	const { Fake, calls } = elementClass();
	const seen = [];
	await patchPrototype(fakeRegistry({ 'x-el': Fake }), 'x-el', 'render', instance => { seen.push(instance); });

	const instance = new Fake();
	assert.equal(instance.render(1, 2), 'rendered', 'the page still gets its own return value');
	assert.deepEqual(seen, [instance], 'the hook ran, and against the instance');
	assert.deepEqual(calls[0][1], [1, 2], 'the original method keeps its arguments');
});

test('a hook that throws does not stop the element rendering', async () => {
	const { Fake } = elementClass();
	await patchPrototype(fakeRegistry({ 'x-el': Fake }), 'x-el', 'render', () => { throw new Error('boom'); });
	// A blurred post is a far better failure than a post that never appears.
	assert.equal(new Fake().render(), 'rendered');
});

test('patching twice does not stack a second proxy', async () => {
	const { Fake } = elementClass();
	let ran = 0;
	const registry = fakeRegistry({ 'x-el': Fake });
	await patchPrototype(registry, 'x-el', 'render', () => { ran++; });
	await patchPrototype(registry, 'x-el', 'render', () => { ran++; });

	new Fake().render();
	assert.equal(ran, 1, 'an injected-twice script must not run its hook twice per render');
});

test('a tag the page never defines is not an error', async () => {
	// Reddit ships different elements to different surfaces, so most of the list
	// is absent on any given page. An unhandled rejection here would surface as a
	// page-world error in the console on every load.
	await assert.doesNotReject(() => patchPrototype(fakeRegistry({}), 'never-here', 'render', () => {}));
});

test('a blurred container is revealed for its own reason and left alone for the other', async () => {
	const { Fake } = elementClass('render');
	const registry = fakeRegistry({ 'shreddit-blurred-container': Fake });
	await Promise.all(installReveal({ customElements: registry }, { nsfw: true, spoiler: false }));

	const nsfw = new Fake();
	nsfw.reason = 'nsfw';
	nsfw.blurred = true;
	nsfw.render();
	assert.equal(nsfw.blurred, false, 'an nsfw post is revealed when nsfw is on');

	const spoiler = new Fake();
	spoiler.reason = 'spoiler';
	spoiler.blurred = true;
	spoiler.render();
	assert.equal(spoiler.blurred, true, 'a spoiler stays blurred while only nsfw is on');
});

test('the isolated world is refused rather than silently reaching nothing', () => {
	// A content script's isolated world answers `typeof customElements === 'object'`
	// for a `customElements` that is `null` — which is exactly how a guard of that
	// shape passed here before while patching nothing at all.
	assert.deepEqual(installReveal({ customElements: null }, { nsfw: true, spoiler: true }), []);
	assert.deepEqual(installReveal({}, { nsfw: true, spoiler: true }), []);
	assert.deepEqual(installReveal({ customElements: {} }, { nsfw: true, spoiler: true }), []);
});

test('both toggles off patches nothing at all', () => {
	const registry = fakeRegistry({});
	assert.deepEqual(installReveal({ customElements: registry }, { nsfw: false, spoiler: false }), []);
});

test('every target names a method, and the entry passes only the two flags across', () => {
	// Wrapping `render` on an element that only implements `update` installs a
	// hook on a method nothing calls, which is indistinguishable from working.
	for (const target of REVEAL_TARGETS) {
		assert.ok(target.tag && target.method && target.property, `incomplete target: ${JSON.stringify(target)}`);
		assert.ok(['render', 'update'].includes(target.method), `unexpected lifecycle method ${target.method}`);
	}
	assert.equal(BLUR_CLASS, 'thumbnail-blur');
	assert.equal(BLUR_CLASS_TAG, 'faceplate-img');

	// The page world gets the toggles and nothing else — no storage, no
	// extension APIs, none of which exist on that side.
	assert.match(entry, /installReveal\(window, \{/);
	assert.match(entry, /resSlimRevealNsfw === '1'/);
	assert.match(entry, /resSlimRevealSpoiler === '1'/);
	assert.doesNotMatch(entry, /from '\.\.\/(core|environment)/, 'the page world cannot import the extension');
});

test('the module injects the page script by src, which is the only form MV3 allows', () => {
	// An inline script a content script writes is checked against the extension's
	// own CSP, not the page's, and MV3 refuses it. That is what left
	// eventTrackingSabotage inert for its entire life.
	assert.match(mod, /script\.src = getURL\(PAGE_SCRIPT\)/);
	assert.doesNotMatch(mod, /script\.textContent\s*=/, 'an inline page script is silently blocked under MV3');
	assert.match(mod, /if \(isAppType\('d2x'\)\)/, 'the old-Reddit watcher must not run on current Reddit');
});
