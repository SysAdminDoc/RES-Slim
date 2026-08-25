/* @flow */
// RES-Slim: show the real thumbnail on NSFW and spoiler posts.
//
// The NSFW-unblur userscripts are the single biggest reddit cluster by installs,
// but every one of them targets the redesign, where the block is a React overlay.
// On old.reddit the mechanism is different and much simpler: reddit swaps the
// thumbnail's `src` for a flat placeholder graphic and leaves the real preview
// URL in the row's own `data-url` / `data-permalink` attributes. Nothing is
// fetched here — the image the browser loads is the one reddit already sent.
//
// This does not touch the account-level "show me NSFW content" setting and it
// does not bypass an age gate; a post reddit refused to send is still not here.
// frictionRemovers owns the /over18 interstitial.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';

export const module: Module<{ [string]: any }> = new Module('nsfwThumbnails');

module.moduleName = 'Show NSFW and spoiler thumbnails';
module.category = 'browsingCategory';
module.description = 'Replaces the flat NSFW / spoiler placeholder graphic with the post\'s real thumbnail, and clears the blur old.reddit applies to spoiler previews. Uses the preview URL reddit already sent with the page.';
module.descriptionRaw = true;
module.include = ['linklist', 'search', 'profile', 'commentsLinklist', 'comments'];
module.disabledByDefault = true;
module.keywords = ['nsfw', 'spoiler', 'thumbnail', 'blur', 'preview'];

module.options = {
	showNsfw: {
		type: 'boolean',
		value: true,
		title: 'Restore NSFW thumbnails',
		description: 'Replaces the "nsfw" placeholder tile with the actual preview.',
	},
	showSpoilers: {
		type: 'boolean',
		value: false,
		title: 'Restore spoiler thumbnails',
		description: 'Off by default. A spoiler tag is usually deliberate, unlike the NSFW placeholder which reddit applies to a whole subreddit at a time.',
	},
	markRestored: {
		type: 'boolean',
		value: true,
		title: 'Outline restored thumbnails',
		description: 'A thin marker so a restored NSFW thumbnail is not mistaken for an ordinary one on a shared screen.',
	},
};

const ATTR = 'data-rsm-nsfw-thumb';
const PLACEHOLDER_CLASSES = ['nsfw', 'spoiler'];

// The thumbnail element is an <a class="thumbnail nsfw"> whose <img> src points
// at reddit's static placeholder. The real preview lives on the row.
function previewUrlFor(thing: Thing): ?string {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return null;

	// reddit renders the preview it already generated into this attribute on
	// every listing row that has one, NSFW or not.
	const dataUrl = el.getAttribute('data-url');
	if (typeof dataUrl === 'string' && /^https?:\/\//.test(dataUrl) && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(dataUrl)) {
		return dataUrl;
	}

	// i.redd.it and preview.redd.it links have no extension but are images.
	if (typeof dataUrl === 'string' && /^https?:\/\/(i|preview)\.redd\.it\//.test(dataUrl)) return dataUrl;

	return null;
}

function restore(thing: Thing) {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	if (el.hasAttribute(ATTR)) return;

	const thumb = el.querySelector('a.thumbnail');
	if (!(thumb instanceof HTMLElement)) return;

	const isNsfw = thumb.classList.contains('nsfw') || el.classList.contains('over18');
	const isSpoiler = thumb.classList.contains('spoiler') || el.classList.contains('spoiler');
	if (isNsfw && !module.options.showNsfw.value) return;
	if (isSpoiler && !isNsfw && !module.options.showSpoilers.value) return;
	if (!isNsfw && !isSpoiler) return;

	const url = previewUrlFor(thing);
	const img = thumb.querySelector('img');

	el.setAttribute(ATTR, '1');

	// The placeholder is a class on the anchor, and old.reddit's own stylesheet
	// paints it through a background image; removing the class is what actually
	// clears it. Both classes go, because a post can carry both.
	for (const cls of PLACEHOLDER_CLASSES) thumb.classList.remove(cls);
	thumb.style.filter = 'none';

	if (img instanceof HTMLImageElement) {
		img.style.filter = 'none';
		if (url) img.src = url;
	} else if (url) {
		// A placeholder tile sometimes has no <img> at all.
		const created = document.createElement('img');
		created.src = url;
		created.alt = '';
		created.width = 70;
		thumb.append(created);
	}

	if (module.options.markRestored.value) {
		thumb.style.outline = '2px solid #e0245e';
		thumb.style.outlineOffset = '1px';
		thumb.title = 'NSFW thumbnail restored by RES-Slim';
	}
}

module.contentStart = () => {
	watchForThings(['post'], restore);
};
