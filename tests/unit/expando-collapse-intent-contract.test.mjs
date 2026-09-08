import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, installDom } from './helpers/loadModule.mjs';
import { readRepoFile } from './helpers/loadFlowModule.mjs';

// Collapsing an expando is two different operations wearing one name.
//
// When the reader collapses one, destroying the content is right: they asked,
// and re-expanding rebuilds it. When a filter hides the post the expando is in,
// destroying it is wrong — nobody asked, the post may be unhidden a moment
// later, and what goes with it is a CodePen mid-edit or a filled-in poll.
//
// Four of the thirty-five `IFRAME` hosts declare a pause command. For the other
// thirty-one `Iframe.collapse()` falls through to `this.element.remove()`, which
// is how routing the hide path through the collapse lifecycle turned "stop the
// sound" into "drop the frame".

installDom({ url: 'https://old.reddit.com/r/example/' });

const mediaTypes = await loadModule('lib/modules/showImages/mediaTypes.js', 'expando-collapse-intent', { dom: false });

function iframeMedia({ pause } = {}) {
	return mediaTypes.generateMedia({
		type: 'IFRAME',
		embed: 'https://player.example.com/embed/1',
		pause,
		width: '640',
		height: '360',
	}, { href: 'https://player.example.com/watch/1' });
}

function attach(media) {
	document.body.append(media.element);
	// `loaded` is what the pause branch checks; a frame that never loaded has
	// nothing to pause and would take the removal path for a different reason.
	media.loaded = true;
	return media;
}

test('a deliberate collapse still drops a frame that cannot be paused', () => {
	// Unchanged behaviour, and the reason the removal exists: the reader asked,
	// and expanding again rebuilds.
	const media = attach(iframeMedia());
	assert.ok(document.body.contains(media.element));

	media.collapse();
	assert.equal(document.body.contains(media.element), false, 'a reader-driven collapse may still drop it');
});

test('a hide leaves a frame that cannot be paused exactly where it was', () => {
	const media = attach(iframeMedia());
	const before = media.element.innerHTML;

	media.collapse({ keepContent: true });

	assert.ok(document.body.contains(media.element), 'hiding a post must not destroy its embed');
	assert.equal(media.element.innerHTML, before, 'and must not reload it out from under itself');
	assert.equal(media.loaded, true, 'the frame is still loaded, because nothing was taken away');
});

test('a frame that declares a pause command is paused rather than kept playing', () => {
	const media = attach(iframeMedia({ pause: '{"event":"command","func":"pauseVideo"}' }));
	const posted = [];
	// jsdom gives the iframe a contentWindow; the message is what a real player
	// would act on, and posting it is the whole point of declaring one.
	Object.defineProperty(media.iframe, 'contentWindow', {
		value: { postMessage: (message, origin) => posted.push([message, origin]) },
		configurable: true,
	});

	media.collapse({ keepContent: true });

	assert.equal(posted.length, 1, 'a host that says how to pause it must be asked to');
	assert.equal(posted[0][0], '{"event":"command","func":"pauseVideo"}');
	assert.ok(document.body.contains(media.element), 'and it is paused rather than dropped');
});

test('the generic expando is kept on a hide and dropped on a collapse', () => {
	// `Generic` removes its content unconditionally, for the same reason and with
	// the same problem.
	const build = () => mediaTypes.generateMedia({
		type: 'GENERIC_EXPANDO',
		generate: () => {
			const div = document.createElement('div');
			div.textContent = 'a thing the reader was using';
			return div;
		},
	}, { href: 'https://example.com/x' });

	const kept = attach(build());
	kept.collapse({ keepContent: true });
	assert.ok(document.body.contains(kept.element), 'hiding a post must not destroy a generic expando');

	const dropped = attach(build());
	dropped.collapse();
	assert.equal(document.body.contains(dropped.element), false, 'a reader-driven collapse still drops it');
});

test('the hide path asks for the keeping kind, and the expando forwards it', () => {
	// The three links in the chain. Executing the whole of it needs a real
	// `Expando` in a real registry, which only `linkScanner` builds; these are the
	// joints where the intent could be dropped.
	const images = readRepoFile('lib/modules/showImages.js');
	assert.match(images, /expando\.collapse\(\{ keepContent: true \}\)/, 'the filter path must ask for the keeping kind');

	const expando = readRepoFile('lib/modules/showImages/expando.js');
	assert.match(expando, /collapse\(options\?: \{\| keepContent\?: boolean \|\}\)/, 'the expando has to take the option');
	assert.match(expando, /this\.media\.collapse\(options\)/, 'and forward it, or it stops at the expando');
});

test('the collapser looks inside the hidden thing rather than walking every expando', () => {
	// `expandos` grows for the life of an infinite-scroll session, and this runs
	// once per hidden thing across four filter modules.
	const images = readRepoFile('lib/modules/showImages.js');
	assert.match(images, /element\.querySelectorAll\(Expando\.expandoSelector\)/);
	assert.ok(!/for \(const expando of expandos\.values\(\)\) \{\s*\n\s*if \(!\(expando instanceof Expando\) \|\| !expando\.open\)/.test(images),
		'walking the global registry per hidden thing is O(hidden x expandos)');
});

test('a framed third party cannot navigate the tab out from under the reader', () => {
	// Thirty-five hosts go through this one template, each running its own script
	// inside a reddit.com page. The frame carried no sandbox at all.
	const media = iframeMedia();
	const iframe = media.element.querySelector('iframe');
	assert.ok(iframe, 'the template should build an iframe');

	const sandbox = iframe.getAttribute('sandbox') || '';
	const granted = sandbox.split(/\s+/).filter(Boolean);

	// The one that matters: neither form of top-navigation is granted.
	assert.ok(!granted.includes('allow-top-navigation'), 'top navigation must not be granted');
	assert.ok(!granted.includes('allow-top-navigation-by-user-activation'), 'nor the user-activation form of it');
	assert.ok(!granted.includes('allow-top-navigation-to-custom-protocols'));

	// And the ones the embeds genuinely need, or they fail to load rather than
	// merely losing a feature. A cross-origin frame without allow-same-origin
	// gets a null origin and loses its own cookies and storage; allow-downloads
	// is what the download buttons on the paste and playground hosts need, and a
	// sandbox without it silently takes them away.
	for (const token of ['allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-forms', 'allow-downloads']) {
		assert.ok(granted.includes(token), `${token} is needed by the shipped hosts`);
	}

	// A document-level <meta name="referrer"> of unsafe-url on the embedding page
	// would otherwise hand every host the full post URL.
	assert.equal(iframe.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');

	// No `allow`, and this assertion is the point rather than an omission. An
	// earlier version of this file required autoplay, encrypted-media and
	// picture-in-picture to be delegated, on the stated grounds that the sandbox
	// took them away. It does not: `sandbox` has no token for any of the three.
	// autoplay and encrypted-media default to an allowlist of `self`, which a
	// cross-origin frame is not, so listing them granted a capability instead of
	// restoring one -- an autoplay grant lets a host that plays by itself do so
	// with `autoplayVideo` switched off. picture-in-picture defaults to `*`, so
	// listing it was merely redundant.
	assert.equal(iframe.getAttribute('allow'), null, 'the frame must not be granted more than it had');

	// Fullscreen comes from the attribute that predates the sandbox.
	assert.equal(iframe.getAttribute('allowFullScreen'), 'true');
});
