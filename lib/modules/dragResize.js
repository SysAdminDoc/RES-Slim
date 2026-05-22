/* @flow */
// RES-Slim: drag-to-resize inline image and video expandos. Attaches a
// resize handle to media expanded by showImages so the user can grow or
// shrink the visible media without leaving the listing. Lifted from the
// REL pattern, rebuilt against the v0.5 selector map.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { Storage } from '../environment';
import { computeNextSize } from '../utils/dragResize';

export const module: Module<*> = new Module('dragResize');

module.moduleName = 'Drag-to-resize expandos';
module.category = 'productivityCategory';
module.description = 'Add a bottom-right corner handle to inline images and videos. Drag to resize; hold Shift to free the aspect ratio. Saved per-host so future expandos open at your preferred size.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['drag', 'resize', 'expando', 'media', 'image', 'video'];

module.options = {
	keepAspect: {
		type: 'boolean',
		value: true,
		title: 'Keep aspect ratio by default',
		description: 'Hold Shift while dragging to free the aspect ratio for the current drag.',
	},
	persistPerHost: {
		type: 'boolean',
		value: true,
		title: 'Remember size per host',
		description: 'Save the last dragged size keyed by data-domain. Future expandos from the same host open at that size.',
	},
	minWidth: {
		type: 'text',
		value: '160',
		title: 'Min width (px)',
		description: 'Lower bound on resize.',
	},
	maxWidth: {
		type: 'text',
		value: '1600',
		title: 'Max width (px)',
		description: 'Upper bound on resize.',
	},
};

const HANDLE_CLASS = 'rsm-dragResize-handle';
const MARK_ATTR = 'data-rsm-resize';

const store = Storage.wrapBlob('RESmodules.dragResize.sizes', (): { width: number, height: number } | null => null);
const sizeCache: Map<string, { width: number, height: number }> = new Map();

function intOpt(name: string, fallback: number): number {
	const raw = parseInt(String((module.options[name]: any).value || ''), 10);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function findMedia(expando: HTMLElement): ?HTMLElement {
	const node = expando.querySelector('img, video, iframe');
	return node instanceof HTMLElement ? node : null;
}

function attachHandle(expando: HTMLElement, host: string): void {
	if (expando.querySelector(`:scope > .${HANDLE_CLASS}`)) return;
	const media = findMedia(expando);
	if (!media) return;
	expando.style.position = expando.style.position || 'relative';

	const handle = document.createElement('div');
	handle.className = HANDLE_CLASS;
	handle.setAttribute('role', 'separator');
	handle.setAttribute('aria-label', 'Resize media');
	handle.title = 'Drag to resize · hold Shift to free aspect ratio';
	expando.append(handle);
	expando.setAttribute(MARK_ATTR, '1');

	// Apply persisted size if any.
	const persisted = sizeCache.get(host);
	if (persisted && module.options.persistPerHost.value !== false) {
		media.style.width = `${persisted.width}px`;
		media.style.height = `${persisted.height}px`;
	}

	// Drag state — initialised when a pointerdown lands on the handle.
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let startW = 0;
	let startH = 0;
	let shiftHeld = false;
	let pointerId: ?number = null;

	const teardown = () => {
		dragging = false;
		pointerId = null;
		window.removeEventListener('pointermove', onMove, true);
		window.removeEventListener('pointerup', onEnd, true);
		window.removeEventListener('pointercancel', onEnd, true);
		window.removeEventListener('keydown', onShiftDown, true);
		window.removeEventListener('keyup', onShiftUp, true);
		window.removeEventListener('blur', onEnd, true);
	};

	const persistCurrentSize = () => {
		if (module.options.persistPerHost.value === false || !host) return;
		const rect = media.getBoundingClientRect();
		const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
		sizeCache.set(host, next);
		try { store.set(host, next); } catch (err) { /* storage unavailable in tests */ }
	};

	const onMove = (e: PointerEvent) => {
		if (!dragging || pointerId !== e.pointerId) return;
		const keep = (module.options.keepAspect.value !== false) !== shiftHeld;
		const next = computeNextSize(startW, startH, startX, startY, e.clientX, e.clientY, {
			minWidth: intOpt('minWidth', 160),
			maxWidth: intOpt('maxWidth', 1600),
			minHeight: 100,
			maxHeight: 4000,
			keepAspect: keep,
		});
		media.style.width = `${next.width}px`;
		media.style.height = `${next.height}px`;
	};

	const onEnd = (e: ?Event) => {
		// Accept any of pointerup / pointercancel / window blur as drag end.
		// On pointerup/cancel we have a PointerEvent with the right pointerId;
		// on window blur we cleanup unconditionally.
		if (e && (e: any).pointerId != null && pointerId !== (e: any).pointerId) return;
		const wasDragging = dragging;
		try {
			if (pointerId != null) handle.releasePointerCapture(pointerId);
		} catch (err) { /* ignore */ }
		teardown();
		if (wasDragging) persistCurrentSize();
	};

	const onShiftDown = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld = true; };
	const onShiftUp = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld = false; };

	handle.addEventListener('pointerdown', (e: PointerEvent) => {
		e.preventDefault();
		const rect = media.getBoundingClientRect();
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		startW = rect.width;
		startH = rect.height;
		shiftHeld = e.shiftKey;
		pointerId = e.pointerId;
		try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
		window.addEventListener('pointermove', onMove, true);
		window.addEventListener('pointerup', onEnd, true);
		window.addEventListener('pointercancel', onEnd, true);
		window.addEventListener('keydown', onShiftDown, true);
		window.addEventListener('keyup', onShiftUp, true);
		// Browser tab blur kills pointer events; treat as drag-end.
		window.addEventListener('blur', onEnd, true);
	});
}

function hostFor(thing: Thing): string {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return '';
	return el.getAttribute('data-domain') || el.getAttribute('data-host') || '';
}

function process(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const expando = el.querySelector(':scope > .entry .expando, :scope > .entry .res-expando-box');
	if (!(expando instanceof HTMLElement)) return;
	if (expando.classList.contains('expando-uninitialized')) return;
	attachHandle(expando, hostFor(thing));
}

async function loadInitialCache(): Promise<void> {
	try {
		const all = await store.getAll();
		for (const k of Object.keys(all)) {
			const v = (all: any)[k];
			if (v && typeof v.width === 'number' && typeof v.height === 'number') {
				sizeCache.set(k, { width: v.width, height: v.height });
			}
		}
	} catch (e) { /* storage unavailable in tests */ }
}

module.contentStart = async () => {
	await loadInitialCache();
	watchForThings(['post', 'comment'], process);
	// Re-process when expandos initialise late: showImages flips
	// expando-uninitialized off, so observe that.
	const observer = new MutationObserver(records => {
		for (const rec of records) {
			if (rec.type !== 'attributes') continue;
			const target = rec.target;
			if (target instanceof HTMLElement && target.classList.contains('expando') && !target.classList.contains('expando-uninitialized')) {
				const thing = target.closest('.thing');
				if (!(thing instanceof HTMLElement)) continue;
				const host = thing.getAttribute('data-domain') || thing.getAttribute('data-host') || '';
				attachHandle(target, host);
			}
		}
	});
	observer.observe(document.body || document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
};
