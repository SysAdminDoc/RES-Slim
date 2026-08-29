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

const { silenceWithin, hideAndSilence, registerExpandoCollapser } = await loadFlowModule('lib/utils/mediaSilence.js', 'media-silence');

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

// --- the two cases a `<video>` pause cannot reach ---------------------------
//
// An expando this extension opened owns a `Media` instance that knows how to
// quieten itself, including posting the pause command an embedded player
// understands. Reaching it from `lib/utils/` would be an import cycle, so
// `showImages` registers a collapser instead. These prove the seam is used, and
// that a third-party frame nobody registered a command for is left alone.

test('with no collapser registered, hiding still pauses native media', () => {
	// The seam is filled in by `showImages`. A page where that module never loaded
	// must not lose the behaviour this file already had.
	registerExpandoCollapser(null);
	const thing = post();
	const video = playingMedia('video');
	thing.append(video);

	assert.equal(hideAndSilence(thing), 1);
	assert.equal(video.pauseCalls, 1);

	thing.remove();
});

test('an expando inside the hidden post is collapsed through its own lifecycle', () => {
	const thing = post();
	const box = document.createElement('div');
	thing.append(box);

	const collapsed = [];
	registerExpandoCollapser(element => {
		// The registered collapser is handed the element being hidden, and reports
		// how many it took down so the caller's count stays honest.
		if (!element.contains(box)) return 0;
		collapsed.push(element);
		return 1;
	});

	// One native video plus one expando: the count is both.
	const video = playingMedia('video');
	thing.append(video);
	assert.equal(hideAndSilence(thing), 2);
	assert.equal(collapsed.length, 1, 'the expando inside the hidden post must be collapsed');
	assert.equal(video.pauseCalls, 1, 'and the native pass still runs');

	registerExpandoCollapser(null);
	thing.remove();
});

test('a collapser that throws does not stop the post being hidden', () => {
	const thing = post();
	const video = playingMedia('video');
	thing.append(video);

	registerExpandoCollapser(() => { throw new Error('a broken expando'); });

	// The native pass has already run, so its count survives.
	assert.equal(hideAndSilence(thing), 1);
	assert.equal(video.pauseCalls, 1);
	assert.equal(thing.style.display, 'none', 'the filter must still hide the post');

	registerExpandoCollapser(null);
	thing.remove();
});

test('a third-party iframe with no registered pause command is left in place', () => {
	// Dropping it is the only generic way to stop it, and a filter hides a post
	// the user may unhide a moment later — a permanently empty box is worse than
	// a sound the user's own filter produced.
	const thing = post();
	const frame = document.createElement('iframe');
	frame.src = 'https://player.example.com/embed/1';
	thing.append(frame);

	registerExpandoCollapser(null);
	assert.equal(hideAndSilence(thing), 0, 'there is nothing here this can honestly claim to have silenced');
	assert.ok(thing.contains(frame), 'the frame must survive being hidden');
	assert.equal(frame.getAttribute('src'), 'https://player.example.com/embed/1', 'and must not be reloaded out from under itself');

	thing.remove();
});

test('the choice to leave an unpausable frame alone is stated where it is made', () => {
	// A silent omission and a deliberate one look identical in a diff. This is the
	// one place a reader will look to find out which it is.
	const source = readRepoFile('lib/utils/mediaSilence.js');
	assert.match(source, /iframe/i, 'the file has to say what it does about frames');
	assert.match(source, /left playing, on purpose|left alone/i);
});

test('showImages fills in the seam rather than mediaSilence importing it', () => {
	// The import direction is the whole reason the seam exists: `showImages`
	// imports from `lib/utils/`, so a reverse import would be a cycle.
	const silence = readRepoFile('lib/utils/mediaSilence.js');
	const images = readRepoFile('lib/modules/showImages.js');

	assert.match(silence, /export function registerExpandoCollapser/);
	assert.ok(
		!/from '\.\.\/modules\//.test(codeOnly(silence)),
		'lib/utils/mediaSilence.js must not import a module',
	);
	assert.match(images, /registerExpandoCollapser\(/, 'the producer side has to actually register');
	assert.match(images, /expando\.collapse\(\)/, 'collapse is the lifecycle re-expanding rebuilds from');
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
