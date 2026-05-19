/* @flow */

export const TOAST_HOST_ID = 'rsm-toast-host';

const DEFAULT_TOAST_TIMEOUT_MS = 4200;
const EXIT_TIMEOUT_MS = 220;
const MAX_VISIBLE_TOASTS = 4;
const TONES = new Set(['info', 'success', 'warning', 'error']);

function createElement(documentRef, tagName, className, text) {
	const element = documentRef.createElement(tagName);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

function normalizeToast(input) {
	return typeof input === 'string' ? { message: input } : input;
}

export function createToastHost({ documentRef = document, timeoutMs = DEFAULT_TOAST_TIMEOUT_MS, maxVisible = MAX_VISIBLE_TOASTS } = {}) {
	const host = documentRef.getElementById(TOAST_HOST_ID) || createElement(documentRef, 'div', 'rsm-toast-host');
	host.id = TOAST_HOST_ID;
	host.setAttribute('role', 'region');
	host.setAttribute('aria-label', 'RES-Slim notifications');
	host.setAttribute('aria-live', 'polite');
	host.setAttribute('aria-relevant', 'additions text');

	if (!host.parentNode) {
		(documentRef.body || documentRef.documentElement).appendChild(host);
	}

	const timers = new WeakMap();

	function closeToast(toast) {
		const timer = timers.get(toast);
		if (timer) window.clearTimeout(timer);
		toast.classList.add('is-exiting');
		window.setTimeout(() => toast.remove(), EXIT_TIMEOUT_MS);
	}

	function trimToasts() {
		for (const toast of Array.from(host.querySelectorAll('.rsm-toast')).slice(maxVisible)) {
			closeToast(toast);
		}
	}

	function showToast(input) {
		const data = normalizeToast(input);
		const tone = TONES.has(data.tone) ? data.tone : 'info';
		const toast = createElement(documentRef, 'article', `rsm-toast is-${tone}`);
		const body = createElement(documentRef, 'div', 'rsm-toast-body');
		const close = createElement(documentRef, 'button', 'rsm-toast-close');
		const effectiveTimeout = data.timeoutMs === undefined ? timeoutMs : data.timeoutMs;

		toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
		toast.dataset.tone = tone;

		if (data.title) {
			body.appendChild(createElement(documentRef, 'strong', 'rsm-toast-title', data.title));
		}
		body.appendChild(createElement(documentRef, 'span', 'rsm-toast-message', data.message || 'Done.'));
		toast.appendChild(body);

		if (data.actionLabel && data.onAction) {
			const action = createElement(documentRef, 'button', 'rsm-toast-action', data.actionLabel);
			action.type = 'button';
			action.addEventListener('click', () => {
				data.onAction();
				closeToast(toast);
			});
			toast.appendChild(action);
		}

		close.type = 'button';
		close.setAttribute('aria-label', 'Dismiss notification');
		close.addEventListener('click', () => closeToast(toast));
		toast.appendChild(close);

		host.prepend(toast);
		trimToasts();

		if (effectiveTimeout !== Infinity) {
			timers.set(toast, window.setTimeout(() => closeToast(toast), effectiveTimeout));
		}

		return {
			element: toast,
			close: () => closeToast(toast),
		};
	}

	return {
		host,
		showToast,
		clear: () => host.replaceChildren(),
		destroy: () => host.remove(),
	};
}
