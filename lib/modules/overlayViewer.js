/* @flow */
// RES-Slim: full-bleed overlay viewer for inline images. Clicking any
// expanded image in the listing or thread opens a dim-backdropped viewer
// that fits the image to the viewport. Closes on Esc, click-outside, or the
// close button. A native <dialog> opened with showModal(), so the top layer, the
// focus trap, the inertness of the page behind and Escape are the browser's. No
// keyboard shortcuts of its own.

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('overlayViewer');

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

function imageSource(img: HTMLImageElement): string {
	return img.currentSrc || img.src || '';
}

function readableSourceLabel(src: string): string {
	try {
		const url = new URL(src, location.href);
		return url.hostname.replace(/^www\./, '') || 'Image';
	} catch (e) {
		return 'Image';
	}
}

function isViewerCandidate(target: EventTarget): ?HTMLImageElement {
	if (!(target instanceof HTMLImageElement)) return null;
	const url = imageSource(target);
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
	const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const src = imageSource(img);
	const sourceLabel = readableSourceLabel(src);
	const titleText = img.alt || sourceLabel;
	// Flow 0.84 predates HTMLDialogElement, so the element is held as `any` and
	// the DOM methods are reached through it. Same accommodation Alert makes.
	const overlay: any = document.createElement('dialog');
	overlay.id = OVERLAY_ID;
	// `role` and `aria-modal` are what a <dialog> opened with showModal() already
	// means; stating them by hand was the div's way of asking for behaviour it
	// could not have.
	overlay.setAttribute('aria-labelledby', `${OVERLAY_ID}-title`);
	overlay.setAttribute('aria-describedby', `${OVERLAY_ID}-status`);
	overlay.dataset.state = 'loading';
	const opacity = parseInt(String(module.options.dimBackground.value || '85'), 10);
	// The scrim is ::backdrop now — a real backdrop rather than the dialog's own
	// background, which is what lets the element sit in the top layer without
	// having to be the full-viewport box that paints the dim.
	overlay.style.setProperty('--rsm-overlay-dim', String((Number.isFinite(opacity) ? opacity : 85) / 100));

	const inner = document.createElement('div');
	inner.className = `${OVERLAY_ID}-inner`;

	const toolbar = document.createElement('div');
	toolbar.className = `${OVERLAY_ID}-toolbar`;

	const title = document.createElement('h2');
	title.id = `${OVERLAY_ID}-title`;
	title.className = `${OVERLAY_ID}-title`;
	title.textContent = titleText;

	const controls = document.createElement('div');
	controls.className = `${OVERLAY_ID}-controls`;

	const openLink = document.createElement('a');
	openLink.href = src;
	openLink.target = '_blank';
	openLink.rel = 'noopener noreferrer';
	openLink.className = `${OVERLAY_ID}-open`;
	openLink.textContent = 'Open original';

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.className = `${OVERLAY_ID}-close`;
	closeBtn.textContent = '×';
	closeBtn.title = 'Close viewer (Esc)';
	closeBtn.setAttribute('aria-label', 'Close image viewer');

	controls.append(openLink, closeBtn);
	toolbar.append(title, controls);
	inner.append(toolbar);

	const figure = document.createElement('figure');
	figure.className = `${OVERLAY_ID}-figure`;

	const display = document.createElement('img');
	display.src = src;
	display.alt = img.alt || '';
	display.className = `${OVERLAY_ID}-img`;
	figure.append(display);

	const status = document.createElement('figcaption');
	status.id = `${OVERLAY_ID}-status`;
	status.className = `${OVERLAY_ID}-status`;
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	status.textContent = `Loading image from ${sourceLabel}`;
	figure.append(status);

	display.addEventListener('load', () => {
		overlay.dataset.state = 'loaded';
		status.textContent = `${sourceLabel} image loaded`;
	}, { once: true });
	display.addEventListener('error', () => {
		overlay.dataset.state = 'error';
		// Say what to do next: the overwhelmingly common causes are a dead link
		// or a host that refuses hotlinked requests, and both are recoverable by
		// opening the original in a tab.
		status.textContent = `Couldn't load this image from ${sourceLabel}. It may have been removed, or the host may block embedding — try "Open original".`;
	}, { once: true });

	inner.append(figure);

	overlay.append(inner);
	document.body.append(overlay);
	document.body.classList.add(`${OVERLAY_ID}-open`);

	const handleClick = (e: MouseEvent) => {
		if (e.target === overlay || e.target === closeBtn) closeOverlay();
	};
	overlay.addEventListener('click', handleClick);
	// Escape reaches the dialog as `cancel`. Letting it run would close the
	// element without the rest of closeOverlay(), so the body class and the focus
	// restore would be skipped; taking it over routes every exit through one path.
	overlay.addEventListener('cancel', (e: Event) => {
		e.preventDefault();
		closeOverlay();
	});
	overlay._cleanup = () => { overlay.removeEventListener('click', handleClick); };
	overlay._restoreFocus = restoreFocus;

	// The top layer, the focus trap and the inertness of everything behind are all
	// showModal()'s, not this module's. Tab cycling used to be forty lines here.
	overlay.showModal();
	// Focus lands on the close button rather than the dialog itself so the first
	// Tab is predictable and a screen reader announces the way out first.
	closeBtn.focus();
}

function closeOverlay(): void {
	const overlay: any = document.getElementById(OVERLAY_ID);
	if (overlay instanceof HTMLElement) {
		const cleanup = overlay._cleanup;
		const restoreFocus = overlay._restoreFocus;
		if (typeof cleanup === 'function') cleanup();
		// An open dialog has to leave the top layer before it leaves the document;
		// removing it while open leaves the page inert in some engines.
		if (overlay.open && typeof overlay.close === 'function') overlay.close();
		overlay.remove();
		if (restoreFocus instanceof HTMLElement && restoreFocus.isConnected) {
			restoreFocus.focus();
		}
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
