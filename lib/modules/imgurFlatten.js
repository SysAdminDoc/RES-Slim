/* @flow */
// RES-Slim: imgur albums paywalled their direct HTML in 2025. This module
// rewrites album/gallery URLs through a rimgo-style mirror so the existing
// showImages expando pipeline can resolve them again. Posts whose data-url is an
// imgur album get their title link, data-url, and expando trigger rewritten.
//
// The mirror setting is a list, and the first healthy entry wins. A single
// hardcoded default has died twice here (rimgo.totaldarkness.net → 502, then
// ri.bcow.xyz → 403), each time shipping a visibly broken module until someone
// noticed months later. See lib/utils/imgurFlatten.js.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { ajax, Permissions } from '../environment';
import {
	DEFAULT_MIRROR_LIST,
	extractAlbumId,
	isImgurAlbumUrl,
	originForMirror,
	parseMirrorList,
	pickHealthyMirror,
	probeUrlFor,
	rewriteAlbumUrl,
} from '../utils/imgurFlatten';
import { showNotification } from './notifications';

export const module: Module<*> = new Module('imgurFlatten');

module.moduleName = 'Imgur album flatten';
module.category = 'productivityCategory';
module.description = 'Rewrite imgur album / gallery URLs through a rimgo mirror so album browsing still works after imgur paywalled the direct HTML. Tries each mirror in order and uses the first one that answers. Only album / gallery URLs are touched; bare i.imgur.com direct uploads are untouched.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['imgur', 'album', 'gallery', 'rimgo', 'mirror', 'paywall'];

module.options = {
	mirrors: {
		type: 'text',
		value: DEFAULT_MIRROR_LIST,
		title: 'Mirror base URLs',
		description: 'Comma- or newline-separated rimgo (or compatible) instances, tried in order. The first one that responds is used for the rest of the page. Public instance list: <code>https://rimgo.codeberg.page/</code>.',
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

// Resolved once per page load. Posts that arrive before the probe settles are
// queued rather than rewritten through a mirror we have not checked — writing
// the wrong host into data-url is not something a later pass can undo, because
// the original URL is gone by then.
let resolvedMirror: ?string = null;
let mirrorResolution: ?Promise<?string> = null;
let allMirrorsFailed = false;

// Mirrors whose probe never left the browser because the extension holds no host
// permission for them. Kept apart from "the host is down": the remedy is a click,
// not a different mirror, and conflating the two is what the old status-only
// probe did.
const ungranted: string[] = [];

// rimgo instances send no `Access-Control-Allow-Origin`, so — unlike Arctic
// Shift, pullpush and Wayback, which work purely on their own CORS `*` — the
// service worker's fetch is blocked outright until the user grants the host.
// Verified 2026-08-18 against the built extension: without this the fetch rejects
// with "Failed to fetch" and *every* mirror reads as dead, which is precisely how
// this module came to ship doing nothing at all.
async function ensureMirrorPermission(mirror: string): Promise<boolean> {
	const origin = originForMirror(mirror);
	if (!origin) return false;
	if (await Permissions.has([origin])) return true;
	try {
		await Permissions.request([origin]);
		return true;
	} catch (e) {
		return false;
	}
}

// `ajax` throws a FetchError carrying `.status` for any non-2xx, so the status
// has to be read off the throw as well as off the response — otherwise a 429
// (rate-limited, but alive) is indistinguishable from a dead host and we rotate
// away from a working mirror on one busy moment. The body comes back on the same
// response at no extra cost, and is what separates a live instance from an
// anti-bot interstitial answering 200.
async function probeMirror(mirror: string): Promise<{| status: number, body: string |}> {
	if (!await ensureMirrorPermission(mirror)) {
		ungranted.push(mirror);
		return { status: 0, body: '' };
	}
	try {
		const response = await ajax({ url: probeUrlFor(mirror), type: 'raw', method: 'GET' });
		return {
			status: response && typeof response.status === 'number' ? response.status : 0,
			body: response && typeof response.text === 'string' ? response.text : '',
		};
	} catch (e) {
		return { status: e && typeof e.status === 'number' ? e.status : 0, body: '' };
	}
}

function reportNoMirror(mirrors: string[]): void {
	if (allMirrorsFailed) return;
	allMirrorsFailed = true;

	// One toast per page, and only when *every* mirror is unusable — a single
	// dead instance is a non-event. Which of the two reasons it was matters: a
	// missing permission is fixed with a click, a dead host is fixed by editing
	// the list, and telling the user to do the wrong one wastes their time.
	const message = ungranted.length === mirrors.length ?
		`Imgur albums are being left alone: this extension has no permission to read ${ungranted.length === 1 ? 'the configured mirror' : 'any of the configured mirrors'}. Reload the page and accept the permission prompt, or grant it from the extension's site-access settings.` :
		`None of the ${mirrors.length} configured mirrors served rimgo, so imgur albums are being left alone. A mirror that answers but shows a bot check does not count. Check the public instance list at rimgo.codeberg.page and update the setting.`;

	showNotification({
		moduleID: 'imgurFlatten',
		notificationID: 'imgurFlatten-all-down',
		header: 'Imgur album flatten',
		message,
		closeDelay: 15000,
	});
}

function resolveMirror(): Promise<?string> {
	if (!mirrorResolution) {
		const mirrors = parseMirrorList(module.options.mirrors.value);
		mirrorResolution = pickHealthyMirror(mirrors, probeMirror).then(mirror => {
			resolvedMirror = mirror;
			if (!mirror) reportNoMirror(mirrors);
			return mirror;
		});
	}
	return mirrorResolution;
}

function applyRewrite(el: HTMLElement, url: string, mirror: string): void {
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
			title.title = `Imgur album ${extractAlbumId(url)} (mirror: ${new URL(mirror).host})`;
		}
	}
}

function process(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	if (el.getAttribute(MARK_ATTR) === '1') return;
	const url = el.getAttribute('data-url') || '';
	if (!isImgurAlbumUrl(url)) return;

	// Mark immediately so a re-entrant watcher pass cannot double-process while
	// the probe is in flight.
	el.setAttribute(MARK_ATTR, '1');

	if (resolvedMirror) {
		applyRewrite(el, url, resolvedMirror);
		return;
	}

	resolveMirror().then(mirror => {
		// Still attached? An expando or infiniteScroll may have replaced the row.
		if (mirror && el.isConnected) applyRewrite(el, url, mirror);
	});
}

module.contentStart = () => {
	watchForThings(['post'], process);
};
