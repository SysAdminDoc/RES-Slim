/* @flow */

export const ERROR_LOG_PANEL_ID = 'rsm-error-log-panel';

const MAX_ERROR_ENTRIES = 50;

function createElement(documentRef, tagName, className, text) {
	const element = documentRef.createElement(tagName);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function normalizeError(error) {
	if (error instanceof Error) {
		return {
			message: error.message,
			stack: error.stack || '',
		};
	}

	return {
		message: String(error),
		stack: '',
	};
}

export function createErrorLog({ documentRef = document, toastHost = null, maxEntries = MAX_ERROR_ENTRIES } = {}) {
	const entries = [];
	let panel = null;
	let list = null;

	function renderEntry(entry) {
		const item = createElement(documentRef, 'li', 'rsm-error-entry');
		const title = createElement(documentRef, 'strong', 'rsm-error-title', entry.message);
		const meta = createElement(documentRef, 'span', 'rsm-error-meta', [entry.featureId, entry.stage, entry.timestamp].filter(Boolean).join(' | '));
		const stack = createElement(documentRef, 'pre', 'rsm-error-stack', entry.stack);

		item.append(title, meta);
		if (entry.stack) item.appendChild(stack);
		return item;
	}

	function render() {
		if (!list) return;
		if (!entries.length) {
			const empty = createElement(documentRef, 'li', 'rsm-error-empty', 'No local errors recorded.');
			list.replaceChildren(empty);
			return;
		}
		list.replaceChildren(...entries.map(renderEntry));
	}

	function mountPanel() {
		if (panel) return panel;

		panel = createElement(documentRef, 'section', 'rsm-error-log-panel');
		panel.id = ERROR_LOG_PANEL_ID;
		panel.hidden = true;
		panel.setAttribute('aria-hidden', 'true');
		panel.setAttribute('aria-label', 'RES-Slim local error log');

		const header = createElement(documentRef, 'header', 'rsm-error-log-header');
		const title = createElement(documentRef, 'h2', null, 'Local error log');
		const close = createElement(documentRef, 'button', 'rsm-error-log-close');
		close.type = 'button';
		close.textContent = 'Close';
		close.addEventListener('click', () => setOpen(false));

		list = createElement(documentRef, 'ol', 'rsm-error-log-list');
		header.append(title, close);
		panel.append(header, list);
		(documentRef.body || documentRef.documentElement).appendChild(panel);
		render();
		return panel;
	}

	function setOpen(open) {
		mountPanel();
		panel.hidden = !open;
		panel.classList.toggle('is-active', open);
		panel.setAttribute('aria-hidden', String(!open));
	}

	function record(error, context = {}) {
		const normalized = normalizeError(error);
		const entry = {
			id: `${Date.now()}-${entries.length}`,
			timestamp: new Date().toISOString(),
			message: normalized.message || 'Unknown error',
			stack: normalized.stack,
			featureId: context.featureId || '',
			stage: context.stage || '',
		};

		entries.unshift(entry);
		entries.splice(maxEntries);
		render();

		if (toastHost && toastHost.showToast) {
			toastHost.showToast({
				tone: 'error',
				title: 'Feature error',
				message: entry.message,
			});
		}

		return entry;
	}

	function destroy() {
		entries.splice(0);
		if (panel) panel.remove();
		panel = null;
		list = null;
	}

	return {
		record,
		mountPanel,
		open: () => setOpen(true),
		close: () => setOpen(false),
		getEntries: () => [...entries],
		destroy,
	};
}
