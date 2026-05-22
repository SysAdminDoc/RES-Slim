/* @flow */
// RES-Slim: on the /search results listing, surface inline thumbnail
// previews for image/gallery posts. Reddit's search results omit reddit's
// own thumbnail markup, so the search page reads as a wall of text. This
// module fetches the post JSON once per visible search hit and stitches
// the preview image (or first gallery image) into the search row.

import { Module } from '../core/module';
import { isPageType, watchForThings } from '../utils';
import { createRateLimiter } from '../utils/rateLimiter';
import { parseGalleryFromJson } from '../utils/galleryZip';

export const module: Module<*> = new Module('searchGallery');

module.moduleName = 'Search-result gallery carousel';
module.category = 'productivityCategory';
module.description = 'On `/search` listings, inline a thumbnail preview (image post) or 4-up carousel strip (gallery post) for each result. Cached per fullname; outbound JSON requests share a 2-token rate limiter.';
module.descriptionRaw = true;
module.include = ['search'];
module.disabledByDefault = true;
module.keywords = ['search', 'gallery', 'preview', 'carousel', 'thumbnail'];

module.options = {
	galleryStripCount: {
		type: 'text',
		value: '4',
		title: 'Gallery preview count',
		description: 'How many images of a gallery to inline as a strip. Range 1-10.',
	},
	maxThumbWidth: {
		type: 'text',
		value: '180',
		title: 'Max thumbnail width (px)',
		description: 'Maximum width per preview. Strip rows scroll horizontally if they would overflow.',
	},
	onlyVisible: {
		type: 'boolean',
		value: true,
		title: 'Only fetch when row is visible',
		description: 'Use IntersectionObserver to defer fetches until each result row scrolls into view.',
	},
};

const limiter = createRateLimiter({ tokens: 2, refillMs: 1500, maxConcurrent: 2 });
const cache: Map<string, string[]> = new Map();

const HOST_CLASS = 'rsm-searchGallery-host';
const STRIP_CLASS = 'rsm-searchGallery-strip';
const THUMB_CLASS = 'rsm-searchGallery-thumb';
const MARK_ATTR = 'data-rsm-search-gallery';

function intOpt(name: string, fallback: number, lo: number = 1, hi: number = 100): number {
	const raw = parseInt(String((module.options[name]: any).value || ''), 10);
	if (!Number.isFinite(raw)) return fallback;
	return Math.max(lo, Math.min(hi, raw));
}

async function fetchUrlsFor(permalink: string): Promise<string[]> {
	const cached = cache.get(permalink);
	if (cached) return cached;
	const urls = await limiter.schedule(async () => {
		const url = `${permalink.replace(/\/$/, '')}.json?raw_json=1`;
		const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (!res.ok) throw new Error(`status ${res.status}`);
		const json = await res.json();
		const items = parseGalleryFromJson(json);
		if (items.length) return items.map(i => i.url);
		// Fall back to the top-level preview image if not a gallery.
		try {
			const post = (((json: any)[0] || {}).data || {}).children;
			if (Array.isArray(post) && post.length) {
				const d = post[0] && post[0].data;
				if (d && d.preview && Array.isArray(d.preview.images) && d.preview.images.length) {
					const src = d.preview.images[0].source && d.preview.images[0].source.url;
					if (typeof src === 'string') return [src.replace(/&amp;/g, '&')];
				}
				if (typeof d.url_overridden_by_dest === 'string' && /\.(jpg|jpeg|png|gif|webp)/i.test(d.url_overridden_by_dest)) {
					return [d.url_overridden_by_dest];
				}
			}
		} catch (e) { /* ignore */ }
		return [];
	});
	cache.set(permalink, urls);
	return urls;
}

function buildStrip(urls: string[], maxWidth: number): HTMLElement {
	const strip = document.createElement('div');
	strip.className = STRIP_CLASS;
	for (const url of urls) {
		const a = document.createElement('a');
		a.href = url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.className = THUMB_CLASS;
		a.style.maxWidth = `${maxWidth}px`;
		const img = document.createElement('img');
		img.src = url;
		img.loading = 'lazy';
		img.decoding = 'async';
		img.alt = '';
		a.append(img);
		strip.append(a);
	}
	return strip;
}

async function decorate(row: HTMLElement): Promise<void> {
	if (row.getAttribute(MARK_ATTR) === '1') return;
	row.setAttribute(MARK_ATTR, '1');
	const permalink = row.getAttribute('data-permalink');
	if (!permalink) return;
	try {
		const urls = await fetchUrlsFor(permalink);
		if (!urls.length) return;
		const stripCount = intOpt('galleryStripCount', 4, 1, 10);
		const maxWidth = intOpt('maxThumbWidth', 180, 60, 600);
		const host = document.createElement('div');
		host.className = HOST_CLASS;
		host.append(buildStrip(urls.slice(0, stripCount), maxWidth));
		const entry = row.querySelector(':scope > .entry');
		if (entry instanceof HTMLElement) entry.append(host);
	} catch (e) { /* swallow */ }
}

function observe(row: HTMLElement): void {
	if (module.options.onlyVisible.value === false) {
		decorate(row);
		return;
	}
	const io = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			io.disconnect();
			decorate(row);
			return;
		}
	}, { rootMargin: '300px 0px' });
	io.observe(row);
}

module.contentStart = () => {
	if (!isPageType('search')) return;
	watchForThings(['post'], thing => {
		const el = thing.element;
		if (el instanceof HTMLElement) observe(el);
	});
};
