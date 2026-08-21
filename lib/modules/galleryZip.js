/* @flow */
// RES-Slim: download every image in a reddit gallery as a single zip plus a
// `captions.txt` sidecar. JSZip ships as a separate file and is injected the
// first time the button is clicked, so a module that is disabled by default
// costs nothing on a page that never uses it.

import { Module } from '../core/module';
import { loadScript } from '../environment';
import { Thing, watchForThings } from '../utils';
import { flashStatus } from '../utils/buttonStatus';
import {
	formatCaptionsText,
	paddedIndex,
	parseGalleryFromJson,
	safeFilename,
} from '../utils/galleryZip';
import type { GalleryItem } from '../utils/galleryZip';
import { fetchRedditJson, isRedditListingPair } from '../utils/redditJson';
import { notifyRedditApiBlocked } from './notifications';

export const module: Module<{ [string]: any }> = new Module('galleryZip');

module.moduleName = 'Gallery ZIP export';
module.category = 'productivityCategory';
module.description = 'Adds a "ZIP gallery" button to reddit gallery posts. Downloads every image plus a `captions.txt` sidecar in one archive. JSZip is loaded on first use.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['gallery', 'zip', 'download', 'archive', 'export'];

module.options = {
	includeCaptionsTxt: {
		type: 'boolean',
		value: true,
		title: 'Include captions.txt',
		description: 'Add a captions.txt sidecar listing each image filename, URL, and caption.',
	},
	maxImages: {
		type: 'text',
		value: '50',
		title: 'Max images per archive',
		description: 'Hard cap; reddit galleries are limited to 20 by default but archived sets may carry more.',
	},
};

const BTN_CLASS = 'rsm-galleryZip-btn';

async function fetchGalleryJson(permalink: string): Promise<GalleryItem[]> {
	const url = `${permalink.replace(/\/$/, '')}.json?raw_json=1`;
	const json = await fetchRedditJson(url, {
		onStatus: notifyRedditApiBlocked,
		validate: isRedditListingPair,
	});
	const items = parseGalleryFromJson(json);
	const limit = Math.max(1, parseInt(String(module.options.maxImages.value || '50'), 10) || 50);
	return items.slice(0, limit);
}

async function fetchImageBlob(url: string): Promise<Blob> {
	const res = await fetch(url, { credentials: 'omit' });
	if (!res.ok) { notifyRedditApiBlocked(res.status); throw new Error(`status ${res.status}`); }
	return res.blob();
}

// `await import('jszip')` looked lazy and was not: the build is `format: 'iife'`
// with no code splitting, so esbuild inlined all 153KB into the foreground
// content script, where it was parsed on every Reddit page for a module that is
// disabled by default. Injecting the vendored file on demand is the same shape
// `showImages` already uses for dashjs, and unlike routing the bytes through the
// service worker it keeps the image Blobs in the page: `chrome.runtime`
// messaging is JSON-serialized, so a Blob or ArrayBuffer does not survive the
// trip in the first place.
//
// `loadScript` is memoized per URL, so repeated clicks inject once.
async function loadJszip(): Promise<any> {
	await loadScript('/jszip.min.js');
	const JSZip = (window: any).JSZip;
	if (typeof JSZip !== 'function') throw new Error('JSZip failed to load');
	return JSZip;
}

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	setTimeout(() => {
		URL.revokeObjectURL(url);
		a.remove();
	}, 1500);
}

async function buildZip(items: GalleryItem[], title: string): Promise<{ blob: Blob, filename: string }> {
	const JSZip = await loadJszip();
	const zip = new JSZip();
	const base = safeFilename(title);
	const folder = zip.folder(base);
	if (!folder) throw new Error('zip folder');
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		try {
			const blob = await fetchImageBlob(item.url);
			folder.file(`${paddedIndex(i, items.length)}.${item.ext}`, blob);
		} catch (err) {
			folder.file(`${paddedIndex(i, items.length)}.${item.ext}.failed.txt`, `Fetch failed: ${String(err && err.message)}\nURL: ${item.url}`);
		}
	}
	if (module.options.includeCaptionsTxt.value !== false) {
		folder.file('captions.txt', formatCaptionsText(items));
	}
	const blob = await zip.generateAsync({ type: 'blob' });
	return { blob, filename: `${base}.zip` };
}

function injectButton(thing: HTMLElement): void {
	if (thing.querySelector(`:scope .${BTN_CLASS}`)) return;
	if (thing.getAttribute('data-is-gallery') !== 'true') return;
	const buttons = thing.querySelector(':scope > .entry ul.flat-list.buttons');
	if (!(buttons instanceof HTMLElement)) return;
	const li = document.createElement('li');
	const a = document.createElement('a');
	a.href = '#';
	a.className = BTN_CLASS;
	a.textContent = 'ZIP gallery';
	a.title = 'Download every image in this gallery as a single zip';
	li.append(a);
	buttons.append(li);

	const restoreText = a.textContent;
	a.addEventListener('click', async (e: Event) => {
		e.preventDefault();
		const permalink = thing.getAttribute('data-permalink') || '';
		if (!permalink) {
			flashStatus(a, 'no permalink', { restore: restoreText, durationMs: 4000 });
			return;
		}
		flashStatus(a, 'fetching…');
		try {
			const items = await fetchGalleryJson(permalink);
			if (!items.length) {
				flashStatus(a, 'no images', { restore: restoreText, durationMs: 4000 });
				return;
			}
			flashStatus(a, `zipping ${items.length}…`);
			const titleEl = thing.querySelector(':scope > .entry p.title > a.title');
			const title = titleEl instanceof HTMLAnchorElement ? titleEl.textContent : '';
			const { blob, filename } = await buildZip(items, title || '');
			triggerDownload(blob, filename);
			flashStatus(a, `✓ ${items.length} images`, { restore: restoreText, durationMs: 5000 });
		} catch (err) {
			flashStatus(a, 'zip failed', { restore: restoreText, durationMs: 5000 });
		}
	});
}

function processThing(thing: Thing): void {
	const el = thing.element;
	if (el instanceof HTMLElement) injectButton(el);
}

module.contentStart = () => {
	watchForThings(['post'], processThing);
};
