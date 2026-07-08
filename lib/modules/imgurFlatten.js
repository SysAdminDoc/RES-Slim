/* @flow */
// RES-Slim: imgur albums paywalled their direct HTML in 2025. This module
// rewrites album/gallery URLs through a configurable rimgo-style mirror so
// the existing showImages expando pipeline can resolve them again. Posts
// whose data-url is an imgur album get their title link, data-url, and
// expando trigger rewritten.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import {
	extractAlbumId,
	isImgurAlbumUrl,
	rewriteAlbumUrl,
	sanitizeMirror,
} from '../utils/imgurFlatten';

export const module: Module<*> = new Module('imgurFlatten');

module.moduleName = 'Imgur album flatten';
module.category = 'productivityCategory';
module.description = 'Rewrite imgur album / gallery URLs through a configurable rimgo mirror so album browsing still works after imgur paywalled the direct HTML. Only album / gallery URLs are touched; bare i.imgur.com direct uploads are untouched.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['imgur', 'album', 'gallery', 'rimgo', 'mirror', 'paywall'];

module.options = {
	mirror: {
		type: 'text',
		value: 'https://ri.bcow.xyz',
		title: 'Mirror base URL',
		description: 'Public rimgo (or compatible) instance. Trailing slash optional. The default is the rimgo maintainer reference instance; check `https://rimgo.codeberg.page/` for the current public list if it goes down.',
	},
	rewriteTitle: {
		type: 'boolean',
		value: true,
		title: 'Rewrite post title link',
		description: 'When a post is an imgur album, change its title `href` to the mirror equivalent.',
	},
	rewriteData: {
		type: 'boolean',
		value: true,
		title: 'Rewrite data-url',
		description: 'Set `data-url` to the mirror equivalent so downstream modules (showImages, downloadButtons, hoverZoom) follow it.',
	},
};

const MARK_ATTR = 'data-rsm-imgur-flatten';

function process(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	if (el.getAttribute(MARK_ATTR) === '1') return;
	const url = el.getAttribute('data-url') || '';
	if (!isImgurAlbumUrl(url)) return;
	const mirror = sanitizeMirror(module.options.mirror.value);
	const rewritten = rewriteAlbumUrl(url, mirror);
	if (!rewritten || rewritten === url) return;

	if (module.options.rewriteData.value !== false) {
		el.setAttribute('data-url', rewritten);
		el.setAttribute('data-domain', new URL(rewritten).host);
	}
	if (module.options.rewriteTitle.value !== false) {
		const title = el.querySelector(':scope > .entry p.title > a.title');
		if (title instanceof HTMLAnchorElement) {
			title.href = rewritten;
			title.title = `Imgur album via ${extractAlbumId(url)} (mirror: ${new URL(mirror).host})`;
		}
	}
	el.setAttribute(MARK_ATTR, '1');
}

module.contentStart = () => {
	watchForThings(['post'], process);
};
