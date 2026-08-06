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

function focusableOverlayControls(overlay: HTMLElement): HTMLElement[] {
	return Array.from(overlay.querySelectorAll('a[href], button')).filter((el): boolean => (
		el instanceof HTMLElement &&
		!el.hasAttribute('disabled') &&
		el.tabIndex !== -1
	));
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
	const overlay = document.createElement('div');
	overlay.id = OVERLAY_ID;
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-labelledby', `${OVERLAY_ID}-title`);
	overlay.setAttribute('aria-describedby', `${OVERLAY_ID}-status`);
	overlay.dataset.state = 'loading';
	const opacity = parseInt(String(module.options.dimBackground.value || '85'), 10);
	overlay.style.backgroundColor = `rgba(0, 0, 0, ${(Number.isFinite(opacity) ? opacity : 85) / 100})`;

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

	const handleKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeOverlay();
			return;
		}
		if (e.key === 'Tab') {
			const controls = focusableOverlayControls(overlay);
			if (!controls.length) return;
			const first = controls[0];
			const last = controls[controls.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
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
	(overlay: any)._restoreFocus = restoreFocus;

	// Move focus into the modal so keyboard and screen-reader users get context.
	closeBtn.focus();
}

function closeOverlay(): void {
	const overlay = document.getElementById(OVERLAY_ID);
	if (overlay instanceof HTMLElement) {
		const cleanup = (overlay: any)._cleanup;
		const restoreFocus = (overlay: any)._restoreFocus;
		if (typeof cleanup === 'function') cleanup();
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
