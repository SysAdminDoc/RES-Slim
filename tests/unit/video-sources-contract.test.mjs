import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';

// A video link whose type no engine recognises is a normal outcome, not a crash.
//
// `Video`'s constructor filtered the declared sources through `canPlayType`,
// wrote "No playable sources were found" when nothing survived, and then carried
// on into code that reads `sourceElements[0]`. That threw, `expand()` caught the
// throw and re-hid the box, so the reader never saw the message that had just
// been written for them — only a button that did nothing, on every click.
//
// `.mkv` and `.3gp` are how a reader reaches that state without anything being
// broken: `defaultVideo` built the type from the file extension, and neither
// `video/mkv` nor `video/3gp` is a registered MIME subtype.

installDom({ url: 'https://old.reddit.com/r/example/' });

const mediaTypes = await loadModule('lib/modules/showImages/mediaTypes.js', 'video-sources', { dom: false });

const { __targetDefault: defaultVideo } = await loadModule('lib/modules/hosts/defaultVideo.js', 'video-sources-host', {
	stubEnvironment: true,
	exportDefault: true,
});

function videoMedia(type) {
	return mediaTypes.generateMedia({
		type: 'VIDEO',
		sources: [{ source: 'https://example.com/clip.mkv', type }],
	}, { href: 'https://example.com/clip.mkv' });
}

test('an unplayable video says so instead of throwing', () => {
	// jsdom answers '' to every `canPlayType`, which is the same answer a real
	// engine gives for `video/mkv` — so this is the shipped path, not a shim.
	let media;
	assert.doesNotThrow(() => { media = videoMedia('video/x-matroska'); }, 'the constructor must survive having no playable source');

	const error = media.element.querySelector('.res-video-error');
	assert.ok(error, 'the error line should exist');
	assert.equal(error.hidden, false, 'the error line should be visible');
	assert.match(error.textContent, /No playable sources were found/);
});

test('an unplayable video builds no download control, because there is nothing to download', () => {
	const media = videoMedia('video/x-matroska');
	// `addControls` is what used to read `sourceElements[0].getAttribute('src')`.
	// Returning before it is the fix, and this is how that is observable.
	assert.equal(media.element.querySelector('.res-media-controls'), null);
});

test('defaultVideo maps every extension it detects onto a real MIME subtype', () => {
	const typeFor = href => {
		const detected = defaultVideo.detect(new URL(href));
		assert.ok(detected, `${href} should be detected`);
		return defaultVideo.handleLink(href, detected).sources[0].type;
	};

	// The two that were wrong. `video/mkv` and `video/3gp` are not registered
	// types, so `canPlayType` answered '' for them in every engine.
	assert.equal(typeFor('https://example.com/clip.mkv'), 'video/x-matroska');
	assert.equal(typeFor('https://example.com/clip.3gp'), 'video/3gpp');

	// Unchanged, including the ogv special case that was already handled.
	assert.equal(typeFor('https://example.com/clip.ogv'), 'video/ogg');
	assert.equal(typeFor('https://example.com/clip.webm'), 'video/webm');
	assert.equal(typeFor('https://example.com/clip.mp4'), 'video/mp4');

	// The extension arrives from the URL, so casing is the reader's, not ours.
	assert.equal(typeFor('https://example.com/clip.MKV'), 'video/x-matroska');
});
