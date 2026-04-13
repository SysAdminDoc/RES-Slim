/* @flow */
// RES-Slim: add download buttons next to images and videos on post pages.
// Inspired by 956MB's "Reddit Download Buttons" userscript.
// Note: v.redd.it streams video+audio in separate DASH tracks. This module downloads
// the video track only; audio merging would require ffmpeg-wasm which is too heavy
// for a client-side module. Users who need audio can use an external merger.

import { Module } from '../core/module';
import { Thing, watchForThings, string } from '../utils';

export const module: Module<*> = new Module('downloadButtons');

module.moduleName = 'Media download buttons';
module.category = 'appearanceCategory';
module.description = 'Adds a Download button next to images and v.redd.it videos on post pages. v.redd.it videos download without audio (Reddit serves audio as a separate DASH track).';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'commentsLinklist'];
module.options = {
	showOnImages: {
		type: 'boolean',
		value: true,
		title: 'Show on images',
		description: 'Add Download button next to inline images.',
	},
	showOnVideos: {
		type: 'boolean',
		value: true,
		title: 'Show on videos',
		description: 'Add Download button next to v.redd.it and other video expandos.',
	},
};

function directUrl(src: string): string {
	try {
		const u = new URL(src, location.origin);
		if (u.hostname === 'v.redd.it') {
			// If it's the DASH manifest, grab the highest-resolution fallback.
			if (u.pathname.endsWith('/DASHPlaylist.mpd') || u.pathname.endsWith('/HLSPlaylist.m3u8')) {
				const id = u.pathname.split('/')[1];
				return `https://v.redd.it/${id}/DASH_720.mp4`;
			}
			return u.toString();
		}
		return u.toString();
	} catch {
		return src;
	}
}

function filenameFor(url: string): string {
	try {
		const u = new URL(url);
		const base = u.pathname.split('/').filter(Boolean).pop() || 'reddit-download';
		return base.replace(/[^\w.\-]/g, '_');
	} catch {
		return 'reddit-download';
	}
}

function makeButton(src: string): HTMLElement {
	const url = directUrl(src);
	return string.html`<a class="res-slim-download-btn" title="Download" style="margin-left:6px; font-size:11px;" href="${url}" download="${filenameFor(url)}" target="_blank" rel="noopener">\u2B07 download</a>`;
}

function decorate(thing: Thing) {
	const expando = thing.entry.querySelector('.expando');
	if (!(expando instanceof HTMLElement)) return;
	if (expando.querySelector('.res-slim-download-btn')) return;

	if (module.options.showOnImages.value) {
		const img: ?HTMLImageElement = (expando.querySelector('img.preview, img.may-blank-within, img'): any);
		if (img && img.src) {
			img.insertAdjacentElement('afterend', makeButton(img.src));
			return;
		}
	}
	if (module.options.showOnVideos.value) {
		const video: ?HTMLVideoElement = (expando.querySelector('video, video source'): any);
		if (video) {
			const src = video.currentSrc || video.src || (video.querySelector('source'): any)?.src;
			if (src) video.insertAdjacentElement('afterend', makeButton(src));
		}
	}
}

module.contentStart = () => {
	watchForThings(['post', 'comment'], (thing: Thing) => {
		// Run on next paint so showImages has time to inflate the expando.
		requestAnimationFrame(() => decorate(thing));
		// And again after a short delay for expandos that load async.
		setTimeout(() => decorate(thing), 1000);
	});
};
