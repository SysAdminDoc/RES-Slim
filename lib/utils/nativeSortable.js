/* @flow */

import { closestHtml } from './dom';

export function makeSortable(container: HTMLElement, { handle, group }: {| handle: string, group?: string |}) {
	for (const item of container.children) {
		setupItem(item, handle);
	}

	const observer = new MutationObserver(mutations => {
		for (const m of mutations) {
			for (const node of m.addedNodes) {
				if (node instanceof HTMLElement) setupItem(node, handle);
			}
		}
	});
	observer.observe(container, { childList: true });

	container.addEventListener('dragover', (e: DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

		const dragging = container.querySelector('.rsm-sortable-dragging') ||
			(group ? document.querySelector(`.rsm-sortable-dragging[data-rsm-sort-group="${group}"]`) : null);
		if (!dragging) return;

		const target = closestSortableChild(container, e.target);
		if (!target || target === dragging) return;

		const rect = target.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		if (e.clientY < midY) {
			target.before(dragging);
		} else {
			target.after(dragging);
		}
	});

	container.addEventListener('drop', (e: DragEvent) => {
		e.preventDefault();
		const dragging = container.querySelector('.rsm-sortable-dragging') ||
			(group ? document.querySelector(`.rsm-sortable-dragging[data-rsm-sort-group="${group}"]`) : null);
		if (dragging) {
			dragging.classList.remove('rsm-sortable-dragging');
			container.dispatchEvent(new Event('change', { bubbles: true }));
		}
	});

	if (group) container.dataset.rsmSortGroup = group;
}

function setupItem(item: Element, handleSelector: string) {
	if (!(item instanceof HTMLElement)) return;
	// Bound to a const because the `instanceof` refinement above does not survive
	// into the closures below — `item` is a parameter, so it could in principle be
	// reassigned, and every `.draggable` / `.dataset` inside a listener was
	// therefore unchecked.
	const el = item;
	if (el.draggable) return;

	const handleEl = el.querySelector(handleSelector);
	if (!handleEl) {
		el.draggable = true;
	} else {
		handleEl.addEventListener('mousedown', () => { el.draggable = true; });
		handleEl.addEventListener('mouseup', () => { el.draggable = false; });
	}

	el.addEventListener('dragstart', (e: DragEvent) => {
		el.classList.add('rsm-sortable-dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', '');
		}
		const group = closestHtml(el, '[data-rsm-sort-group]');
		if (group) el.dataset.rsmSortGroup = group.dataset.rsmSortGroup;
	});

	el.addEventListener('dragend', () => {
		el.classList.remove('rsm-sortable-dragging');
		el.draggable = false;
	});
}

function closestSortableChild(container: HTMLElement, target: ?EventTarget): ?HTMLElement {
	if (!(target instanceof HTMLElement)) return null;
	let el = target;
	while (el && el.parentElement !== container) {
		el = el.parentElement;
	}
	return el instanceof HTMLElement ? el : null;
}
