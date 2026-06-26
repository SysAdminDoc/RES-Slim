/* @flow */

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
	if (item.draggable) return;

	const handleEl = item.querySelector(handleSelector);
	if (!handleEl) {
		item.draggable = true;
	} else {
		handleEl.addEventListener('mousedown', () => { item.draggable = true; });
		handleEl.addEventListener('mouseup', () => { item.draggable = false; });
	}

	item.addEventListener('dragstart', (e: DragEvent) => {
		item.classList.add('rsm-sortable-dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', '');
		}
		const group = item.closest('[data-rsm-sort-group]');
		if (group) item.dataset.rsmSortGroup = group.dataset.rsmSortGroup;
	});

	item.addEventListener('dragend', () => {
		item.classList.remove('rsm-sortable-dragging');
		item.draggable = false;
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
