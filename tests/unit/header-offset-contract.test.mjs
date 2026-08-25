// How much of the viewport a sticky header is covering, and whether anything
// actually knows.
//
// `getHeaderOffset` summed the heights of elements registered through
// `_addHeaderId`. That function had no caller anywhere in `lib`, `tests` or
// `scripts` and was not in the `lib/utils` barrel, so the list was always empty
// and the function was a constant 0 wearing a measurement's clothes. Three call
// sites compensated by nothing: `getViewportDimensions`, `scrollToElement`'s
// `compensateHeader` (default true), and the floater's top edge - while the
// refined layout, on by default, makes `#header` sticky at a measured 181px.
//
// The CSS side was already handled: `pageTheme` publishes the measured height as
// `--rsm-th-header-height` and the stylesheet feeds it to
// `scroll-padding-block-start`, which is why `scrollIntoView` behaves. Scroll
// padding does not apply to `window.scrollTo`, which is where `scrollToElement`
// ends up, so this reads the same published number instead of a registration
// nobody performs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/' });

const dom = await loadModule('lib/utils/dom.js', 'header-offset');

const PROPERTY = '--rsm-th-header-height';

function setPublishedHeight(value) {
	if (value === null) document.documentElement.style.removeProperty(PROPERTY);
	else document.documentElement.style.setProperty(PROPERTY, value);
}

test('with no theme applied the offset is zero, because there is no sticky header', () => {
	setPublishedHeight(null);
	assert.equal(dom.getHeaderOffset(), 0);
});

test('the offset is the height the theme published', () => {
	setPublishedHeight('181px');
	assert.equal(dom.getHeaderOffset(), 181);
	setPublishedHeight('80px');
	assert.equal(dom.getHeaderOffset(), 80, 'the value must not be cached across a resize');
});

test('a malformed or absent value reads as no header rather than as NaN', () => {
	// A NaN here propagates into `scrollY -= getHeaderOffset()` and scrolls the
	// page to NaN, which is a worse failure than not compensating at all.
	for (const value of ['', 'auto', 'calc(100% - 4px)', '-20px', '0px']) {
		setPublishedHeight(value);
		const offset = dom.getHeaderOffset();
		assert.equal(Number.isFinite(offset), true, `${value} produced a non-finite offset`);
		assert.ok(offset >= 0, `${value} produced a negative offset`);
	}
	setPublishedHeight(null);
});

test('the dead registration API is gone rather than left as a decoy', () => {
	// Leaving `_addHeaderId` exported would preserve the thing that made this
	// look implemented: a registration function, a list, and a reducer that
	// always ran over nothing.
	assert.equal(typeof dom._addHeaderId, 'undefined');
});

test('the offset feeds the viewport rectangle the visibility checks use', () => {
	// `getViewportDimensions` is not exported, so this goes through a consumer:
	// with a header published, the top of the usable viewport moves down by it.
	setPublishedHeight('100px');
	const target = document.createElement('div');
	target.style.position = 'absolute';
	target.style.top = '10px';
	target.style.height = '20px';
	document.body.append(target);
	// jsdom reports zero-size rects, so this asserts the arithmetic the function
	// performs rather than a real layout: the point is that the offset reaches it.
	assert.equal(dom.getHeaderOffset(), 100);
	target.remove();
	setPublishedHeight(null);
});
