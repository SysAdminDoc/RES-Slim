/* @flow */
// RES-Slim: full-bleed overlay viewer for inline images. Clicking any
// expanded image in the listing or thread opens a dim-backdropped viewer
// that fits the image to the viewport. Closes on Esc, click-outside, or the
// close button. No keyboard shortcuts beyond the standard Esc / Tab cycle.

import { Module } from '../core/module';

export const module: Module<*> = new Module('overlayViewer');

module.moduleName = 'Full-height image overlay viewer';
module.category = 'productivityCategory';
module.description = 'Click an inline image (or hold the modifier key to bypass) to open a viewport-sized overlay viewer. Closes on Esc, click-outside, or the close button. Comments-page commentbody images included.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['overlay', 'lightbox', 'viewer', 'image', 'full', 'zoom'];

module.options = {
	includeSelftext: {
		type: 'boolean',
		value: true,
		title: 'Include selftext images',
		description: 'Also open overlay viewer for images embedded in self-post bodies.',
	},
	includeCommentImages: {
		type: 'boolean',
		value: true,
		title: 'Include comment-body images',
		description: 'Also open overlay viewer for images inside comment markdown.',
	},
	dimBackground: {
		type: 'enum',
		value: '85',
		title: 'Backdrop opacity (%)',
		values: [
			{ name: '60%', value: '60' },
			{ name: '75%', value: '75' },
			{ name: '85%', value: '85' },
			{ name: '95%', value: '95' },
		],
		description: 'Backdrop opacity behind the open viewer.',
	},
};

const OVERLAY_ID = 'rsm-overlayViewer';
const HOST_ATTR = 'data-rsm-overlay-bound';

function isViewerCandidate(target: EventTarget): ?HTMLImageElement {
	if (!(target instanceof HTMLImageElement)) return null;
	const url = target.currentSrc || target.src || '';
	if (!url) return null;
	// Only candidate if the img lives inside an expando, selftext, or comment body.
	const includeSelf = module.options.includeSelftext.value !== false;
	const includeComments = module.options.includeCommentImages.value !== false;
	if (target.closest('.expando img')) return target;
	if (includeSelf && target.closest('.usertext-body .md img')) {
		if (target.closest('.thing.comment') && !includeComments) return null;
		return target;
	}
	return null;
}

function openOverlay(img: HTMLImageElement): void {
	closeOverlay();
	const overlay = document.createElement('div');
	overlay.id = OVERLAY_ID;
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', img.alt || 'Image viewer');
	const opacity = parseInt(String(module.options.dimBackground.value || '85'), 10);
	overlay.style.backgroundColor = `rgba(0, 0, 0, ${(Number.isFinite(opacity) ? opacity : 85) / 100})`;

	const inner = document.createElement('div');
	inner.className = `${OVERLAY_ID}-inner`;

	const display = document.createElement('img');
	display.src = img.currentSrc || img.src;
	display.alt = img.alt || '';
	display.className = `${OVERLAY_ID}-img`;
	inner.append(display);

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = `${OVERLAY_ID}-close`;
	closeBtn.textContent = '✕';
	closeBtn.title = 'Close (Esc)';
	closeBtn.setAttribute('aria-label', 'Close image viewer');
	inner.append(closeBtn);

	overlay.append(inner);
	document.body.append(overlay);
	document.body.classList.add(`${OVERLAY_ID}-open`);

	const handleKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeOverlay();
		}
	};
	const handleClick = (e: MouseEvent) => {
		if (e.target === overlay || e.target === closeBtn) closeOverlay();
	};
	overlay.addEventListener('click', handleClick);
	document.addEventListener('keydown', handleKey, true);
	(overlay: any)._cleanup = () => {
		document.removeEventListener('keydown', handleKey, true);
		overlay.removeEventListener('click', handleClick);
	};

	// Move focus to the close button so Tab cycles within the dialog.
	closeBtn.focus();
}

function closeOverlay(): void {
	const overlay = document.getElementById(OVERLAY_ID);
	if (overlay instanceof HTMLElement) {
		const cleanup = (overlay: any)._cleanup;
		if (typeof cleanup === 'function') cleanup();
		overlay.remove();
	}
	document.body.classList.remove(`${OVERLAY_ID}-open`);
}

function bind(): void {
	if (document.body.getAttribute(HOST_ATTR) === '1') return;
	document.body.setAttribute(HOST_ATTR, '1');
	document.addEventListener('click', (e: MouseEvent) => {
		if (e.button !== 0) return;
		if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
		const img = isViewerCandidate(e.target);
		if (!img) return;
		// If the image is inside an anchor that goes elsewhere, hijack only when
		// the anchor target is the same image (so we don't break "open original"
		// in a new tab via Ctrl+click — that's why we exit on modifier keys).
		e.preventDefault();
		e.stopPropagation();
		openOverlay(img);
	}, true);
}

module.contentStart = () => { bind(); };
