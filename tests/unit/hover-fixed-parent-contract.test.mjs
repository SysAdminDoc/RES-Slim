// A hover opened over a pinned toolbar must not outlive itself.
//
// The popover watches for scrolling when its target sits inside a `position:
// fixed` ancestor, because a fixed target moves under a page that scrolls while
// the popover does not. That watch used to unsubscribe itself from inside its own
// handler, so it was only ever released when a scroll actually happened. Move the
// pointer away instead and the listener stayed, holding the hover and the element
// it pointed at, and the next hover from the same instance added another one.
//
// The second half is worse than a leak. The flag that says "this one is
// positioned against the viewport" was set on the way in and never cleared, so
// after a single hover over a pinned element every later hover from that instance
// positioned itself `fixed` while its coordinates were still being computed
// without the scroll offset. The popover stuck to the viewport at a spot that had
// nothing to do with what was hovered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const HTML = `<!doctype html><html><body>
	<div id="bar" style="position: fixed">
		<a id="pinned" href="/user/one">one</a>
	</div>
	<div id="feed">
		<a id="inline" href="/user/two">two</a>
	</div>
</body></html>`;

const hover = await loadModule('lib/modules/hover.js', 'hover-fixed-parent', {
	stubEnvironment: true,
	dom: { html: HTML },
});

// Every `scroll` registration made from here on, with the options it was given.
// A listener released through an abort signal never reaches
// `removeEventListener`, so counting removals would prove nothing; what is live
// is what was registered against a signal that has not been aborted.
const registrations = [];
const nativeAdd = Element.prototype.addEventListener;
Element.prototype.addEventListener = function addEventListener(type, listener, options) {
	if (type === 'scroll') registrations.push({ target: this, options });
	return Reflect.apply(nativeAdd, this, [type, listener, options]);
};

const live = () => registrations.filter(({ options }) => options && options.signal && !options.signal.aborted).length;

// jsdom does no layout, so `offsetParent` is null on everything and the hover
// refuses to open at all. This is the one thing the test has to lie about.
function visible(element) {
	Reflect.defineProperty(element, 'offsetParent', { configurable: true, value: document.body });
	return element;
}

const pinned = visible(document.getElementById('pinned'));
const inline = visible(document.getElementById('inline'));

const card = hover.infocard('fixed-parent-contract');
// `persistent: false` keeps this off the module's options table -- the instance
// list is a stored preference and a test has no business writing to it.
card.options({ enabled: true, openDelay: 0, fadeDelay: 0, fadeSpeed: 0, closeOnMouseOut: false, width: 300 }, false);
// Elements, not strings: `populate` no longer takes a string, because the branch
// that did assigned it to `innerHTML` raw.
const contents = () => {
	const title = document.createElement('h3');
	title.textContent = 'a title';
	const body = document.createElement('div');
	body.textContent = 'a body';
	return [title, body];
};
card.populateWith(contents);

async function openOn(element) {
	card.target(element);
	card.open();
	// `open()` paints a load indicator synchronously and the real contents a
	// microtask later. Both go through `populate()`, which is exactly where the
	// listener is registered, so a test that only looked at the first one would
	// miss a listener per repopulate.
	await new Promise(resolve => { setTimeout(resolve, 0); });
}

test('one scroll listener per open, and none once the hover is closed', async () => {
	for (const pass of [1, 2, 3]) {
		await openOn(pinned); // eslint-disable-line no-await-in-loop
		assert.equal(live(), 1, `pass ${pass} left ${live()} scroll listeners attached while open`);
		card.close();
		assert.equal(live(), 0, `pass ${pass} left ${live()} scroll listeners attached after close`);
	}

	// Three opens, three registrations. Two per open would mean the load indicator
	// and the real contents each bound their own.
	assert.equal(registrations.length, 3, `three opens registered ${registrations.length} listeners`);

	// And it is registered the way a listener that only ever closes a popover
	// should be: it never calls preventDefault, so it has no business holding up
	// a scroll.
	for (const { options } of registrations) {
		assert.equal(options.passive, true, 'the scroll listener is not passive');
		assert.equal(options.capture, true, 'the scroll listener does not capture');
	}
});

test('a scroll closes the open hover exactly once, and a closed one hears nothing', async () => {
	await openOn(pinned);

	// The listener lands on the element inside the fixed ancestor, which for this
	// markup is the target itself.
	const [{ target }] = registrations.slice(-1);
	assert.ok(target.contains(pinned) || target === pinned, 'the listener was bound somewhere unrelated to the target');

	let closes = 0;
	const inherited = Reflect.getPrototypeOf(card).close;
	card.close = function close(...args) { closes += 1; return Reflect.apply(inherited, this, args); };

	target.dispatchEvent(new Event('scroll'));
	assert.equal(closes, 1, `one scroll ran the close handler ${closes} times`);
	assert.equal(card.visible, false, 'the hover stayed open through a scroll');

	// Closed, the accumulated listeners of four opens must be silent. Under the
	// old shape each open added one that only released itself on the first scroll
	// it saw, so this is where they would all answer at once.
	closes = 0;
	target.dispatchEvent(new Event('scroll'));
	assert.equal(closes, 0, `${closes} listeners from earlier hovers are still attached`);

	Reflect.deleteProperty(card, 'close');
});

test('the next hover over an ordinary target positions itself in the page again', async () => {
	await openOn(pinned);
	assert.equal(card.getContainer().style.position, 'fixed', 'a hover over a pinned element should track the viewport');
	card.close();

	await openOn(inline);
	assert.equal(
		card.getContainer().style.position,
		'absolute',
		'the hover stayed pinned to the viewport after the pinned target was gone',
	);
	// Nothing to watch for either: an ordinary target does not move under a
	// scrolling page.
	assert.equal(live(), 0, 'an ordinary target still registered a scroll listener');
	card.close();
});
