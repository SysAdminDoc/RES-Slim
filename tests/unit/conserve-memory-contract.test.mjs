// Two small things that only go wrong while the reader is doing something else.
//
// The conserve-memory observer unloads images that scroll off screen and loads
// them back when they return. Making an element fullscreen makes
// IntersectionObserver report that nothing intersects, so the callback ignores
// non-intersecting entries while fullscreen is active -- with `return`, which
// abandons the rest of the batch. A batch carries every entry the observer has
// to report, and it does not redeliver them, so an image that had just scrolled
// into view kept its 1x1 placeholder until it left the viewport and came back.
//
// The volume slider is bound to `mousemove` while the button is held, and wrote
// the level to storage on every one of them: about sixty messages to the
// background and sixty `chrome.storage.local` writes for a one-second drag, for
// a setting whose only reader is the next video to load.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, readRepoFile } from './helpers/loadFlowModule.mjs';

// The observer callback, lifted out of the module and run. The module builds it
// inside `enableConserveMemory`, which reaches most of `showImages` on the way
// -- so the callback is reconstructed here from the source that ships, and the
// assertion below pins the source it was reconstructed from.
function boxCallback({ fullscreen, loaded, unobserved }) {
	const ioBox = { unobserve: target => { unobserved.push(target); } };
	const fullscreenActive = () => fullscreen;
	const boxMap = new Map();
	const mediaFor = name => ({ setLoaded: value => { loaded.push([name, value]); } });

	const run = entries => {
		for (const { isIntersecting, target } of entries) {
			if (!isIntersecting && fullscreenActive()) continue;
			const { media } = boxMap.get(target) || {};
			if (media) media.setLoaded(isIntersecting);
			else ioBox.unobserve(target);
		}
	};

	return {
		ioBox,
		boxMap,
		mediaFor,
		run,
	};
}

test('one off-screen entry during fullscreen does not abandon the rest of the batch', () => {
	const loaded = [];
	const unobserved = [];
	const { boxMap, mediaFor, run } = boxCallback({ fullscreen: true, loaded, unobserved });

	const offScreen = { id: 'off' };
	const onScreen = { id: 'on' };
	boxMap.set(offScreen, { media: mediaFor('off') });
	boxMap.set(onScreen, { media: mediaFor('on') });

	run([
		{ isIntersecting: false, target: offScreen },
		{ isIntersecting: true, target: onScreen },
	]);

	// The off-screen one is skipped, which is the point of the guard. The one
	// that came into view is loaded, which is what `return` used to lose.
	assert.deepEqual(loaded, [['on', true]], `the batch stopped early: ${JSON.stringify(loaded)}`);
});

test('outside fullscreen every entry is still answered', () => {
	const loaded = [];
	const unobserved = [];
	const { boxMap, mediaFor, run } = boxCallback({ fullscreen: false, loaded, unobserved });

	const first = { id: 'a' };
	const second = { id: 'b' };
	boxMap.set(first, { media: mediaFor('a') });
	boxMap.set(second, { media: mediaFor('b') });

	run([
		{ isIntersecting: false, target: first },
		{ isIntersecting: true, target: second },
	]);

	assert.deepEqual(loaded, [['a', false], ['b', true]]);
});

test('an expando with no media is still unobserved, whichever entry it is', () => {
	const loaded = [];
	const unobserved = [];
	const { boxMap, mediaFor, run } = boxCallback({ fullscreen: false, loaded, unobserved });

	const gone = { id: 'gone' };
	const live = { id: 'live' };
	boxMap.set(gone, {});
	boxMap.set(live, { media: mediaFor('live') });

	run([
		{ isIntersecting: true, target: gone },
		{ isIntersecting: true, target: live },
	]);

	assert.deepEqual(unobserved, [gone]);
	assert.deepEqual(loaded, [['live', true]]);
});

test('the shipped callback is the one reconstructed above', () => {
	// The reconstruction is only worth anything if it matches. `continue` is the
	// whole fix, and `return` there is the bug.
	const source = codeOnly(readRepoFile('lib/modules/showImages.js'));
	const callback = source.slice(source.indexOf('const ioBox = new IntersectionObserver'), source.indexOf('const buttonMap'));
	assert.match(callback, /if \(!isIntersecting && fullscreenActive\(\)\) continue;/, 'the guard abandons the batch again');
	assert.ok(!/fullscreenActive\(\)\) return;/.test(callback));
	assert.match(callback, /if \(media\) media\.setLoaded\(isIntersecting\);/);
	assert.match(callback, /else ioBox\.unobserve\(target\);/);
});

test('the volume slider remembers the level it was left on, once', () => {
	// `Wrapper.set` has no debounce anywhere in its chain, so every call is a
	// message to the background and a `chrome.storage.local` write.
	const source = codeOnly(readRepoFile('lib/modules/showImages/mediaTypes.js'));
	const block = source.slice(source.indexOf('const persistVolume'), source.indexOf('ctrlVolume.addEventListener'));

	assert.match(block, /const persistVolume = debounce\(level => \{ Video\.volumeStorage\.set\(level\); \}, \d+\);/);
	assert.match(block, /persistVolume\(level\);/, 'the slider does not go through the debounce');
	// And nothing on this path writes straight through any more.
	assert.ok(
		!/volumeStorage\.set\(level\);\s*\n\s*\}\s*\n\s*\};/.test(block),
		'the slider still writes to storage on every mousemove',
	);

	// The video itself is still set at once: a volume that lags the pointer by a
	// quarter second is a different bug.
	assert.match(block, /this\.video\.volume = level;/);
	const setAt = block.indexOf('this.video.volume = level;');
	const persistAt = block.indexOf('persistVolume(level);');
	assert.ok(setAt < persistAt, 'the level is remembered before it is applied');
});

test('the debounce is the shared one, and it is a trailing debounce', async () => {
	// A leading-edge throttle would write the first move of a drag and not the
	// last, which is the wrong end: the level the reader stopped on is the one
	// worth keeping.
	const { debounce } = await import('./helpers/loadFlowModule.mjs')
		.then(({ loadFlowModule }) => loadFlowModule('lib/utils/functional.js', 'conserve-memory-debounce'));

	const written = [];
	const persist = debounce(level => { written.push(level); }, 20);
	for (const level of [0.1, 0.2, 0.3, 0.4, 0.5]) persist(level);
	assert.deepEqual(written, [], 'a drag in progress wrote to storage');

	await new Promise(resolve => { setTimeout(resolve, 60); });
	assert.deepEqual(written, [0.5], 'the level the drag ended on is what was kept');
});
