import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModule } from './helpers/loadModule.mjs';

// What an i.redd.it expando loads.
//
// The handler used to return `preview.source.url` — reddit's signed preview,
// which carries `auto=webp`. Two things followed. The expando showed a re-encoded
// copy at whatever size reddit felt like serving, and the save control fetched
// that same URL, whose path still ends in `.png`, so the file that landed in the
// downloads folder was named `.png` and contained webp bytes.
//
// The decision recorded in the module is: load the original, keep the preview
// only as a ceiling for absurdly large images, and point the save control at the
// original either way. These drive `handleLink` against real metadata shapes
// rather than reading the source, because the interesting cases — a crosspost,
// a gif with an mp4 variant — are about which object the fields are read from,
// and every candidate object has the same field names.

const { __targetDefault: ireddit, originalImageUrl, downloadFilenameUtil } = await loadModule(
	'lib/modules/hosts/ireddit.js',
	'ireddit-original',
	{
		stubEnvironment: true,
		exportDefault: true,
		alsoExport: { downloadFilenameUtil: 'lib/utils/downloadFilename.js' },
	},
);

// The signed preview reddit actually serves: a `.png` path, webp bytes, and an
// `s=` hmac that makes the query non-negotiable.
function previewUrl(name, extension = 'png') {
	return `https://preview.redd.it/${name}.${extension}?width=1080&format=${extension}&auto=webp&s=deadbeef`;
}

function imagePost({ id, url, width, height, extension = 'png', crosspostOf } = {}) {
	const post = {
		id,
		url,
		selftext_html: null,
		preview: { images: [{ source: { url: previewUrl(id, extension), width, height }, variants: {} }] },
	};
	if (crosspostOf) {
		post.crosspost_parent_list = [crosspostOf];
		// A crosspost carries its own preview too, and it is not the one to read.
		post.preview = { images: [{ source: { url: previewUrl(`${id}-wrong`), width: 10, height: 10 }, variants: {} }] };
	}
	return post;
}

// Serve `/by_id/t3_a,t3_b.json` out of a fixture map, so the batching in
// `getPostMetadata` is exercised rather than bypassed.
function serve(posts) {
	globalThis.__resSlimAjax = ({ url }) => {
		const ids = decodeURIComponent(String(url).replace(/^\/by_id\//, '').replace(/\.json$/, '')).split(',');
		return {
			data: {
				children: ids.map(full => {
					const post = posts[full.replace('t3_', '')];
					if (!post) throw new Error(`the test serves no post ${full}`);
					return { data: post };
				}),
			},
		};
	};
}

test.after(() => { delete globalThis.__resSlimAjax; });

test('an ordinary image post expands the original file, not the re-encoded preview', async () => {
	serve({ plain: imagePost({ id: 'plain', url: 'https://i.redd.it/plain.png', width: 3000, height: 2000 }) });

	const media = await ireddit.handleLink('https://i.redd.it/plain.png', 't3_plain');

	assert.equal(media.type, 'IMAGE');
	assert.equal(media.src, 'https://i.redd.it/plain.png', 'the shown image is the original');
	assert.equal(media.downloadSrc, 'https://i.redd.it/plain.png');
	assert.ok(!media.src.includes('auto=webp'), 'a webp re-encode is what this change exists to stop serving');
});

test('the save control names the file after the post and gets the real extension', async () => {
	const { downloadFilename } = downloadFilenameUtil;
	serve({ plain: imagePost({ id: 'plain', url: 'https://i.redd.it/plain.png', width: 3000, height: 2000 }) });

	const media = await ireddit.handleLink('https://i.redd.it/plain.png', 't3_plain');
	assert.equal(downloadFilename('Sunset over the bay', media.downloadSrc), 'Sunset over the bay.png');

	// And the extension has to come from the file that is actually fetched. Run
	// the same call over the preview to show the two differ in what they save:
	// same name, and bytes that are not what the name claims.
	assert.equal(downloadFilename('Sunset over the bay', previewUrl('plain')), 'Sunset over the bay.png');
	assert.ok(previewUrl('plain').includes('auto=webp'), 'which is the trap: the name is right and the bytes are not');
});

test('an image past the pixel ceiling still shows the preview but saves the original', async () => {
	// 12000x6000 is 72 megapixels. Inline, that is tens of megabytes for a post
	// somebody scrolled past, which is what the preview was buying.
	serve({ pano: imagePost({ id: 'pano', url: 'https://i.redd.it/pano.png', width: 12000, height: 6000 }) });

	const media = await ireddit.handleLink('https://i.redd.it/pano.png', 't3_pano');

	assert.equal(media.src, previewUrl('pano'), 'the ceiling has to keep capping the bytes an expando pulls');
	assert.equal(media.downloadSrc, 'https://i.redd.it/pano.png', 'and the reader still saves the real file');
});

test('the ceiling is a ceiling, not a range', async () => {
	// Exactly 24 megapixels: a 6000x4000 camera frame, which is an ordinary post
	// and must not be downgraded.
	serve({ camera: imagePost({ id: 'camera', url: 'https://i.redd.it/camera.jpg', width: 6000, height: 4000, extension: 'jpg' }) });
	const at = await ireddit.handleLink('https://i.redd.it/camera.jpg', 't3_camera');
	assert.equal(at.src, 'https://i.redd.it/camera.jpg');

	// One pixel over.
	serve({ over: imagePost({ id: 'over', url: 'https://i.redd.it/over.jpg', width: 6001, height: 4000, extension: 'jpg' }) });
	const past = await ireddit.handleLink('https://i.redd.it/over.jpg', 't3_over');
	assert.equal(past.src, previewUrl('over', 'jpg'));
});

test('a crosspost reads the parent post it was swapped to, not the link that was followed', async () => {
	// The handler replaces `postMetadata` with `crosspost_parent_list[0]` before
	// reading the preview, so every other field has to come from the same object
	// or the image and its dimensions describe two different posts.
	const parent = imagePost({ id: 'parent', url: 'https://i.redd.it/parent-original.png', width: 1600, height: 900 });
	serve({
		child: imagePost({
			id: 'child',
			url: 'https://i.redd.it/child-copy.png',
			width: 10,
			height: 10,
			crosspostOf: parent,
		}),
	});

	const media = await ireddit.handleLink('https://i.redd.it/child-copy.png', 't3_child');

	assert.equal(media.src, 'https://i.redd.it/parent-original.png');
	assert.equal(media.downloadSrc, 'https://i.redd.it/parent-original.png');
});

test('a crosspost past the ceiling falls back to the parent preview, not the child one', async () => {
	const parent = imagePost({ id: 'parent', url: 'https://i.redd.it/parent-original.png', width: 12000, height: 6000 });
	serve({
		child: imagePost({
			id: 'child',
			url: 'https://i.redd.it/child-copy.png',
			width: 10,
			height: 10,
			crosspostOf: parent,
		}),
	});

	const media = await ireddit.handleLink('https://i.redd.it/child-copy.png', 't3_child');

	assert.equal(media.src, previewUrl('parent'), 'the preview shown has to belong to the post being expanded');
	assert.equal(media.downloadSrc, 'https://i.redd.it/parent-original.png');
});

test('a gif with an mp4 variant is still served as the video, crossposted or not', async () => {
	// The mp4 branch sits above the image branch and is the reason a gif on reddit
	// does not cost 40MB. Nothing here changes it, and a change to the branch below
	// must not reorder it.
	const withMp4 = ({ id, url }) => ({
		id,
		url,
		selftext_html: null,
		preview: {
			images: [{
				source: { url: previewUrl(id, 'gif'), width: 500, height: 500 },
				variants: {
					mp4: { source: { url: `https://preview.redd.it/${id}.gif?format=mp4&s=beef` } },
					gif: { source: { url: `https://preview.redd.it/${id}.gif?format=gif&s=beef` } },
				},
			}],
		},
	});

	serve({ anim: withMp4({ id: 'anim', url: 'https://i.redd.it/anim.gif' }) });
	const direct = await ireddit.handleLink('https://i.redd.it/anim.gif', 't3_anim');

	assert.equal(direct.type, 'VIDEO');
	assert.equal(direct.sources[0].source, 'https://preview.redd.it/anim.gif?format=mp4&s=beef');
	assert.equal(direct.sources[0].type, 'video/mp4');
	assert.equal(direct.fallback, 'https://preview.redd.it/anim.gif?format=gif&s=beef');
	assert.equal(direct.loop, true);
	assert.equal(direct.src, undefined, 'a video has no image src to swap');

	// And through a crosspost, where the parent is the one holding the variants.
	const parent = withMp4({ id: 'animparent', url: 'https://i.redd.it/animparent.gif' });
	const child = imagePost({ id: 'animchild', url: 'https://i.redd.it/animchild.gif', width: 10, height: 10, crosspostOf: parent });
	serve({ animchild: child });

	const crossposted = await ireddit.handleLink('https://i.redd.it/animchild.gif', 't3_animchild');
	assert.equal(crossposted.type, 'VIDEO');
	assert.equal(crossposted.sources[0].source, 'https://preview.redd.it/animparent.gif?format=mp4&s=beef');
});

test('the original is only taken from a URL this handler would have accepted', () => {
	assert.equal(originalImageUrl('https://i.redd.it/a.png'), 'https://i.redd.it/a.png');
	assert.equal(originalImageUrl('https://i.redd.it/a.JPEG'), 'https://i.redd.it/a.JPEG');

	// A lookalike host, which is the whole reason this is a parsed check rather
	// than a substring one.
	assert.equal(originalImageUrl('https://i.redd.it.example.com/a.png'), null);
	assert.equal(originalImageUrl('https://evil.example.com/?x=https://i.redd.it/a.png'), null);
	// Not an image path, so not something to point an `img src` at.
	assert.equal(originalImageUrl('https://i.redd.it/a'), null);
	assert.equal(originalImageUrl('https://i.redd.it/a.png.exe'), null);
	// The query cannot supply the extension.
	assert.equal(originalImageUrl('https://i.redd.it/a?format=png'), null);
	assert.equal(originalImageUrl('http://i.redd.it/a.png'), null, 'plain http is not a scheme to upgrade a load to');
	// Assembled rather than written out, because `no-script-url` flags the literal
	// even in a test asserting that it is rejected.
	assert.equal(originalImageUrl(`${'javascript'}:alert(1)`), null);
	assert.equal(originalImageUrl(''), null);
	assert.equal(originalImageUrl(null), null);
	assert.equal(originalImageUrl(undefined), null);
	assert.equal(originalImageUrl(42), null);
});

test('a post whose url is not the media falls back to the link, then to the preview', async () => {
	// Reddit sets `url` to the media for a link post, but a gallery or a rehost
	// puts something else there, and this handler is reached through `detect` on
	// the href rather than on `url`.
	serve({
		odd: {
			id: 'odd',
			url: 'https://www.reddit.com/gallery/odd',
			selftext_html: null,
			preview: { images: [{ source: { url: previewUrl('odd'), width: 800, height: 600 }, variants: {} }] },
		},
	});
	const viaHref = await ireddit.handleLink('https://i.redd.it/odd.png', 't3_odd');
	assert.equal(viaHref.src, 'https://i.redd.it/odd.png');

	// And with neither usable, the preview is what is left. It is worse than the
	// original, and it is better than refusing to expand the post.
	serve({
		neither: {
			id: 'neither',
			url: 'https://www.reddit.com/gallery/neither',
			selftext_html: null,
			preview: { images: [{ source: { url: previewUrl('neither'), width: 800, height: 600 }, variants: {} }] },
		},
	});
	const viaPreview = await ireddit.handleLink('https://external-preview.redd.it/neither.png', 't3_neither');
	assert.equal(viaPreview.src, previewUrl('neither'));
	assert.equal(viaPreview.downloadSrc, previewUrl('neither'));
});

test('missing dimensions do not silently downgrade a post to its preview', async () => {
	// Reddit has served a preview entry with no `width`, and `NaN > ceiling` is
	// false — but relying on that by accident is how the opposite mistake gets
	// made later. Stated so it is a decision.
	serve({
		nodims: {
			id: 'nodims',
			url: 'https://i.redd.it/nodims.png',
			selftext_html: null,
			preview: { images: [{ source: { url: previewUrl('nodims') }, variants: {} }] },
		},
	});

	const media = await ireddit.handleLink('https://i.redd.it/nodims.png', 't3_nodims');
	assert.equal(media.src, 'https://i.redd.it/nodims.png');
});

test('a post with no preview at all is still refused, as it was before', async () => {
	serve({ bare: { id: 'bare', url: 'https://i.redd.it/bare.png', selftext_html: null } });
	await assert.rejects(
		() => ireddit.handleLink('https://i.redd.it/bare.png', 't3_bare'),
		/no preview/,
	);
});

// --- and the other end of the chain -------------------------------------------
//
// A host returning `downloadSrc` is worth nothing if the save control keeps
// fetching what is on screen. `addControls` takes the lookup URL and the download
// URL as two arguments that were the same value for the whole life of this file,
// which is exactly the kind of pair that stays wired to the wrong one silently.

const { generateMedia, showImages } = await loadModule(
	'lib/modules/showImages/mediaTypes.js',
	'ireddit-download-control',
	{ alsoExport: { showImages: 'lib/modules/showImages.js' } },
);

// The controls are built in the constructor, and only when the reader has them
// turned on. The option object is not populated by `loadOptions` here.
showImages.module.options.mediaControls.value = true;

function clickDownload({ src, downloadSrc }) {
	const media = generateMedia({ type: 'IMAGE', src, downloadSrc }, { href: 'https://old.reddit.com/r/example/comments/x/y/' });
	document.body.append(media.element);

	const asked = [];
	globalThis.__runtimeMessageResponder = message => {
		asked.push(message);
		// `Permissions.request` round-trips through the background too, and refusing
		// it would abort the download before the URL is ever chosen.
		if (message.type === 'permissions') return true;
		return undefined;
	};

	const button = media.element.querySelector('.res-media-controls-download');
	assert.ok(button, 'the save control has to exist for this to mean anything');
	button.dispatchEvent(new window.Event('click', { bubbles: true }));

	return asked;
}

test.after(() => { delete globalThis.__runtimeMessageResponder; });

test('the save control fetches the original even when the preview is what is displayed', async () => {
	const asked = clickDownload({
		src: previewUrl('pano'),
		downloadSrc: 'https://i.redd.it/pano.png',
	});

	// The click handler is three awaited hops deep; let them run.
	await new Promise(resolve => { setTimeout(resolve, 50); });

	const download = asked.find(message => message.type === 'download');
	assert.ok(download, 'the click has to reach the background download handler');
	assert.equal(download.data.url, 'https://i.redd.it/pano.png', 'saving the preview is the defect this whole item is about');
	assert.equal(download.data.filename, 'pano.png', 'and the name comes from the file that is actually fetched');
});

test('a host that says nothing about downloads still saves what it displays', async () => {
	const asked = clickDownload({ src: 'https://i.redd.it/plain.png' });
	await new Promise(resolve => { setTimeout(resolve, 50); });

	const download = asked.find(message => message.type === 'download');
	assert.ok(download);
	assert.equal(download.data.url, 'https://i.redd.it/plain.png', 'thirty-odd other hosts pass no downloadSrc at all');
});
