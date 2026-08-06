/* @flow */

export const TOAST_HOST_ID = 'rsm-toast-host';

const DEFAULT_TOAST_TIMEOUT_MS = 4200;
const EXIT_TIMEOUT_MS = 220;
const MAX_VISIBLE_TOASTS = 4;
const TONES = new Set(['info', 'success', 'warning', 'error']);

// Severity is also carried by a glyph, so success and failure are not told
// apart by the stripe colour alone.
const TONE_GLYPHS = {
	info: 'i',
	success: '✓',
	warning: '!',
	error: '×',
};

const TONE_LABELS = {
	info: 'Information',
	success: 'Success',
	warning: 'Warning',
	error: 'Error',
};

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
	const remaining = new WeakMap();

	function closeToast(toast) {
		const timer = timers.get(toast);
		if (timer) window.clearTimeout(timer);
		toast.classList.add('is-exiting');
		window.setTimeout(() => toast.remove(), EXIT_TIMEOUT_MS);
	}

	// A toast that vanishes while it is being read — or while the pointer is on
	// its own action button — is a dismissal the user did not ask for. Hovering
	// or focusing holds it open, and leaving resumes the time it had left.
	function holdToast(toast) {
		const timer = timers.get(toast);
		if (!timer) return;
		window.clearTimeout(timer);
		timers.delete(toast);
		const state = remaining.get(toast);
		if (state) remaining.set(toast, { ...state, left: Math.max(0, state.left - (Date.now() - state.startedAt)) });
	}

	function resumeToast(toast) {
		const state = remaining.get(toast);
		if (!state || timers.get(toast)) return;
		remaining.set(toast, { ...state, startedAt: Date.now() });
		timers.set(toast, window.setTimeout(() => closeToast(toast), state.left));
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

		const icon = createElement(documentRef, 'span', 'rsm-toast-icon', TONE_GLYPHS[tone]);
		icon.setAttribute('aria-hidden', 'true');
		toast.appendChild(icon);

		// Screen readers get the severity as words; the glyph is decorative.
		body.appendChild(createElement(documentRef, 'span', 'rsm-sr-only', `${TONE_LABELS[tone]}: `));
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
			remaining.set(toast, { left: effectiveTimeout, startedAt: Date.now() });
			timers.set(toast, window.setTimeout(() => closeToast(toast), effectiveTimeout));
			toast.addEventListener('mouseenter', () => holdToast(toast));
			toast.addEventListener('mouseleave', () => resumeToast(toast));
			toast.addEventListener('focusin', () => holdToast(toast));
			toast.addEventListener('focusout', () => resumeToast(toast));
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
