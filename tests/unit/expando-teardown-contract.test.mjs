import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';

// Destroying an expando is not collapsing it, and the difference is everything
// the media registered somewhere else.
//
// `Expando.destroy()` deleted `this.button` and only then called `empty()`,
// whose media branch is reached through a `this.button` guard — so on the
// destroy path the media was dropped without ever being told. For a video that
// meant it stayed in the muted-video manager's list, which polls every entry on
// a 100ms interval and holds each one strongly, so a long infinite scroll left
// the tab polling dozens of dead `<video>` elements for the rest of its life.

installDom({ url: 'https://old.reddit.com/r/example/' });

const { Expando } = await loadModule('lib/modules/showImages/expando.js', 'expando-teardown', { dom: false });
const mediaTypes = await loadModule('lib/modules/showImages/mediaTypes.js', 'expando-teardown-media', { dom: false });

test('destroying an expando tears its media down, while the button is still there', () => {
	const expando = new Expando('https://example.com/clip.mp4');
	document.body.append(expando.button, expando.box);

	const seen = [];
	expando.media = {
		element: document.createElement('div'),
		// Recording the button rather than just the call is what pins the
		// ordering: the old code deleted it first, which is precisely what made
		// this branch unreachable.
		destroy() { seen.push(Boolean(expando.button)); },
	};
	expando.open = true;

	expando.destroy();

	assert.deepEqual(seen, [true], 'media teardown must run, and run before the button is dropped');
	assert.equal(expando.media, undefined, 'the media reference is released');
});

test('an expando emptied without being destroyed still tears its media down', () => {
	// `empty()` is also the conserve-memory path, where the button survives. The
	// media is being discarded either way, so it is told either way.
	const expando = new Expando('https://example.com/clip.mp4');
	document.body.append(expando.button, expando.box);

	let destroyed = 0;
	expando.media = { element: document.createElement('div'), destroy() { destroyed += 1; } };

	expando.empty();

	assert.equal(destroyed, 1);
	assert.ok(expando.button, 'empty() leaves the button in place');
});

test('destroying a video releases it from the muted-video manager and stops the poll', () => {
	// jsdom answers '' to every `canPlayType`, which would leave this video with
	// no source at all. A real engine answers for H.264, so say so. Shadowed as
	// an own property on the video prototype, because `installDom` exposes
	// `HTMLVideoElement` and not the media element it inherits the method from.
	globalThis.HTMLVideoElement.prototype.canPlayType = () => 'probably';

	const realClearInterval = globalThis.clearInterval;
	const cleared = [];
	globalThis.clearInterval = id => { cleared.push(id); return realClearInterval(id); };

	try {
		const media = mediaTypes.generateMedia({
			type: 'VIDEO',
			sources: [{ source: 'https://example.com/clip.mp4', type: 'video/mp4' }],
		}, { href: 'https://example.com/clip.mp4' });

		assert.ok(media.controlsObserver, 'the native-controls observer is held for teardown');

		// This is the registration `_unload()` normally reverses — and cannot,
		// once the element is detached, which it always is by destroy time.
		mediaTypes.mutedVideoManager().observe(media);
		assert.equal(cleared.length, 0, 'sanity: the poll is running while a video is observed');

		media.destroy();

		assert.equal(cleared.length, 1, 'the last video leaving stops the 100ms poll');
		assert.equal(media.controlsObserver, null, 'the attribute observer is disconnected');
	} finally {
		globalThis.clearInterval = realClearInterval;
		delete globalThis.HTMLVideoElement.prototype.canPlayType;
	}
});
