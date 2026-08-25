// Filtering a post has to stop what it was playing.
//
// `display: none` takes an element out of the layout and does nothing to a
// `<video>` or `<audio>` inside it, so hiding a post mid-playback left the audio
// running with nothing on screen to pause. Three modules hide posts -
// `filterRules`, `scopedFilters` and `subredditBlacklist` - and each did it with
// its own bare style assignment, so each had the bug separately. Upstream files
// it as #5567 against a filter UI this fork does not ship; the defect is in the
// replacement.
//
// This runs the helper against real media elements rather than asserting that
// the modules contain a call, because "the call is written" and "the sound
// stops" are different claims.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFlowModule, readRepoFile, codeOnly } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/r/example/' });

const { silenceWithin, hideAndSilence } = await loadFlowModule('lib/utils/mediaSilence.js', 'media-silence');

// jsdom implements the media element interface but not playback, so `paused`
// never flips on its own and `play()` rejects. Drive the state directly: what is
// under test is whether the helper finds every media node and calls pause on it,
// not whether jsdom can decode anything.
function playingMedia(tag) {
	const node = document.createElement(tag);
	let paused = false;
	Object.defineProperty(node, 'paused', { get: () => paused, configurable: true });
	node.pause = () => { paused = true; node.pauseCalls = (node.pauseCalls || 0) + 1; };
	node.pauseCalls = 0;
	return node;
}

function post() {
	const thing = document.createElement('div');
	thing.className = 'thing link';
	document.body.append(thing);
	return thing;
}

test('a playing video inside a hidden post is paused', () => {
	const thing = post();
	const video = playingMedia('video');
	thing.append(video);

	assert.equal(hideAndSilence(thing), 1);
	assert.equal(video.paused, true);
	assert.equal(thing.style.display, 'none');
	thing.remove();
});

test('audio counts too, and so does media nested several levels down', () => {
	const thing = post();
	const wrapper = document.createElement('div');
	const inner = document.createElement('div');
	const audio = playingMedia('audio');
	inner.append(audio);
	wrapper.append(inner);
	thing.append(wrapper);

	assert.equal(hideAndSilence(thing), 1);
	assert.equal(audio.paused, true);
	thing.remove();
});

test('every media element is stopped, not just the first', () => {
	const thing = post();
	const media = [playingMedia('video'), playingMedia('audio'), playingMedia('video')];
	for (const node of media) thing.append(node);

	assert.equal(hideAndSilence(thing), 3);
	for (const node of media) assert.equal(node.paused, true);
	thing.remove();
});

test('already-paused media is left alone and not counted', () => {
	const thing = post();
	const video = playingMedia('video');
	video.pause();
	video.pauseCalls = 0;

	thing.append(video);
	assert.equal(hideAndSilence(thing), 0);
	assert.equal(video.pauseCalls, 0, 'a paused element should not be paused again');
	thing.remove();
});

test('a post with no media hides without incident', () => {
	const thing = post();
	thing.append(document.createElement('p'));
	assert.equal(hideAndSilence(thing), 0);
	assert.equal(thing.style.display, 'none');
	thing.remove();
});

test('the element itself counts when it is the media', () => {
	const video = playingMedia('video');
	document.body.append(video);
	assert.equal(silenceWithin(video), 1);
	assert.equal(video.paused, true);
	video.remove();
});

test('a missing element is not an error', () => {
	assert.equal(silenceWithin(null), 0);
	assert.equal(hideAndSilence(null), 0);
});

test('all three hide paths route through the helper', () => {
	// The helper only helps where it is called. A module that goes back to a bare
	// `style.display = none` on its hide path reintroduces the defect for itself
	// alone, which is exactly how this ended up in three places.
	for (const file of [
		'lib/modules/filterRules.js',
		'lib/modules/scopedFilters.js',
		'lib/modules/subredditBlacklist.js',
		// The same defect, found by grepping for the pattern rather than by
		// waiting for someone to report each one: ignoring a user, the engagement
		// bait filter, repost dedupe, bulk hide, the promoted-post remover (the
		// most likely thing on the page to be autoplaying), and collapsing a
		// comment subtree.
		'lib/modules/userTagger.js',
		'lib/modules/engagementBaitFilter.js',
		'lib/modules/repostDedupe.js',
		'lib/modules/hideAll.js',
		'lib/modules/removePromoted.js',
		'lib/modules/hideChildComments.js',
		'lib/modules/visitedPosts.js',
	]) {
		const source = codeOnly(readRepoFile(file));
		assert.match(source, /hideAndSilence\(/, `${file} does not silence what it hides`);
		assert.doesNotMatch(source, /style\.display\s*=\s*'none'/, `${file} still hides something without silencing it`);
	}
});
