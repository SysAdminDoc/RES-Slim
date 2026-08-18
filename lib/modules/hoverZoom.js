/* @flow */
// RES-Slim: hover-zoom preview for direct image/video links in the feed and
// in comment bodies. Replaces the once-popular Hover Zoom+ extension pattern
// for the narrow case where the link resolves directly to a media file. Host-
// brokered embeds (gfycat, redgifs, youtube, etc.) are deferred to the
// existing showImages expando system.

import { Module } from '../core/module';
import {
	classifyUrl,
	inferUrlFromAnchor,
	placePopover,
} from '../utils/hoverZoom';

export const module: Module<*> = new Module('hoverZoom');

module.moduleName = 'Hover zoom preview';
module.category = 'productivityCategory';
module.description = 'Hover any link to a direct image/video file (`.jpg`/`.png`/`.gif`/`.mp4`/`.webm`/imgur `.gifv`) for an inline preview. Host-brokered embeds still expand inline via `showImages`.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['hover', 'zoom', 'preview', 'image', 'video'];

module.options = {
	delayMs: {
		type: 'text',
		value: '180',
		title: 'Hover delay (ms)',
		description: 'How long the cursor must rest on a link before the preview opens. Default 180.',
	},
	maxWidth: {
		type: 'text',
		value: '480',
		title: 'Max width (px)',
		description: 'Maximum width of the preview popover.',
	},
	maxHeight: {
		type: 'text',
		value: '540',
		title: 'Max height (px)',
		description: 'Maximum height of the preview popover.',
	},
	muteVideos: {
		type: 'boolean',
		value: true,
		title: 'Mute videos',
		description: 'Autoplay video previews muted (Chrome blocks unmuted autoplay).',
	},
	requireDirectUrl: {
		type: 'boolean',
		value: true,
		title: 'Only direct URLs',
		description: 'Skip host-brokered embeds (gfycat, redgifs, youtube). Defaults on so the showImages expando system stays the authority for those.',
	},
};

const POPOVER_ID = 'rsm-hoverZoom-popover';

function intMs(name: string, fallback: number): number {
	const raw = parseInt(String((module.options[name]: any).value || ''), 10);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

let hoverTimer: TimeoutID | null = null;
let activeAnchor: ?HTMLAnchorElement = null;

function destroyPopover(): void {
	const existing = document.getElementById(POPOVER_ID);
	if (existing instanceof HTMLElement) existing.remove();
}

function buildPopover(url: string, kind: 'image' | 'video'): HTMLElement {
	destroyPopover();
	const pop = document.createElement('div');
	pop.id = POPOVER_ID;
	pop.setAttribute('role', 'tooltip');
	let media: HTMLElement;
	if (kind === 'image') {
		const img = document.createElement('img');
		img.src = url;
		img.alt = '';
		img.loading = 'eager';
		media = img;
	} else {
		const video = document.createElement('video');
		video.src = url;
		video.autoplay = true;
		video.loop = true;
		video.controls = false;
		video.playsInline = true;
		if (module.options.muteVideos.value !== false) video.muted = true;
		media = video;
	}
	pop.append(media);
	document.body.append(pop);
	return pop;
}

function positionPopover(pop: HTMLElement, e: MouseEvent): void {
	const maxW = intMs('maxWidth', 480);
	const maxH = intMs('maxHeight', 540);
	pop.style.maxWidth = `${maxW}px`;
	pop.style.maxHeight = `${maxH}px`;
	// Snap to the current rendered size when measurement is available, otherwise
	// use the configured max as a stand-in.
	const rect = pop.getBoundingClientRect();
	const width = rect.width || maxW;
	const height = rect.height || maxH;
	const placement = placePopover(e.clientX, e.clientY, window.innerWidth, window.innerHeight, width, height);
	pop.style.left = `${placement.x}px`;
	pop.style.top = `${placement.y}px`;
	pop.dataset.attach = placement.attach;
}

function scheduleShow(anchor: HTMLAnchorElement, e: MouseEvent): void {
	clear();
	activeAnchor = anchor;
	const delay = intMs('delayMs', 180);
	const requireDirect = module.options.requireDirectUrl.value !== false;
	const href = anchor.href || '';
	const dataUrl = anchor.closest('.thing')?.getAttribute('data-url') || '';
	const url = requireDirect ? inferUrlFromAnchor(href, dataUrl) : (href || dataUrl);
	const kind = classifyUrl(url);
	if (kind === 'none') return;
	hoverTimer = setTimeout(() => {
		if (activeAnchor !== anchor) return;
		const pop = buildPopover(url, kind);
		// Position twice — once with the configured max, then once the actual
		// media size is known so the popover hugs the rendered media.
		positionPopover(pop, e);
		const media = pop.firstElementChild;
		if (media instanceof HTMLElement) {
			const onReady = () => positionPopover(pop, e);
			if (media instanceof HTMLImageElement) {
				if (media.complete) onReady();
				else media.addEventListener('load', onReady, { once: true });
			} else if (media instanceof HTMLVideoElement) {
				media.addEventListener('loadedmetadata', onReady, { once: true });
			}
		}
	}, delay);
}

function clear(): void {
	if (hoverTimer !== null) {
		clearTimeout(hoverTimer);
		hoverTimer = null;
	}
	activeAnchor = null;
	destroyPopover();
}

function handleOver(e: MouseEvent): void {
	const target = e.target;
	if (!(target instanceof Node)) return;
	const anchor = (target instanceof HTMLElement ? target : target.parentElement)?.closest('a[href]');
	if (!(anchor instanceof HTMLAnchorElement)) return;
	// Skip links inside the user-controls (vote/save/hide) where hover-preview
	// would be noise. Use a permissive ancestor check.
	if (anchor.closest('.flat-list.buttons') || anchor.closest('.RES-keyNav-activeElement')) return;
	scheduleShow(anchor, e);
}

function handleOut(e: MouseEvent): void {
	const related = (e: any).relatedTarget;
	if (related instanceof Node && (related === activeAnchor || (activeAnchor && activeAnchor.contains(related)))) return;
	clear();
}

module.contentStart = () => {
	document.addEventListener('mouseover', handleOver, true);
	document.addEventListener('mouseout', handleOut, true);
	// `clear` only tears the preview down, so it must never be able to block
	// scrolling by being treated as potentially preventDefault-ing.
	document.addEventListener('scroll', clear, { capture: true, passive: true });
	window.addEventListener('blur', clear);
};
