/* @flow */
// A modal built on native `<dialog>` + `showModal()`.
//
// The version this replaces was hand-rolled: a fixed-position div over a second
// fixed-position div, with no `role`, no `aria-modal`, no focus trap, no focus
// restore, and — the part that actually changed an outcome — an Escape handler
// that *confirmed* when the dialog was not cancelable. The gesture every user
// reads as "no" could mean "yes", on a dialog whose only button said OK.
//
// `showModal()` supplies the trap, the inertness of everything behind it, the
// `::backdrop`, and Escape-cancels, all from the platform. It is Baseline and
// well inside the chrome 125 / firefox 130 floor.

import { mutex } from './async';
import * as string from './string';

export const open = mutex((content: HTMLElement | string, { cancelable = false }: {| cancelable?: boolean |} = {}): Promise<void> => new Promise((resolve, reject) => {
	// Whatever had focus when the dialog opened. `showModal()` moves focus in and
	// the platform restores it on close — but only if the element is still in the
	// document, and a dialog opened from a control that its own action removes is
	// exactly the case where it is not. Captured so the restore can be re-tried.
	const invoker = document.activeElement;

	// Flow 0.84 predates `<dialog>` entirely — its DOM libdef has no
	// HTMLDialogElement, so `open`, `close()` and `showModal()` are all errors on
	// a correctly-typed element. The cast is narrow and local rather than an
	// application-wide libdef, matching how `redditJson.js` handles AbortController.
	const dialog: any = document.createElement('dialog');
	dialog.id = 'alert_message';
	// `showModal()` already makes it a modal dialog to assistive technology; the
	// attribute is set anyway because the element keeps its semantics if a caller
	// ever opens it non-modally, and because a bare `<dialog>` in the DOM with no
	// `open` reads as nothing at all.
	dialog.setAttribute('aria-modal', 'true');

	const body = content instanceof HTMLElement ? content : string.html`<div>${string.safe(content)}</div>`;
	const buttons = document.createElement('div');
	buttons.className = 'alert_message_buttons';
	dialog.append(body, buttons);
	document.body.append(dialog);

	let settled = false;

	function restoreFocus() {
		if (invoker instanceof HTMLElement && document.contains(invoker)) {
			// Same libdef vintage: `focus(options)` is not declared, though every
			// browser in the support floor honours it. Scrolling the page back to
			// wherever the dialog was opened from would be its own small bug.
			(invoker: any).focus({ preventScroll: true });
		}
	}

	function close() {
		if (dialog.open) dialog.close();
		dialog.remove();
		restoreFocus();
	}

	function confirm() {
		if (settled) return;
		settled = true;
		resolve();
		close();
	}

	function cancel() {
		if (settled) return;
		settled = true;
		reject(new Error('User cancelled alert.'));
		close();
	}

	// The platform fires `cancel` for Escape and `close` for everything else. Both
	// are routed to `cancel()`: Escape must never confirm, and a dialog dismissed
	// by any other means has not been agreed to either.
	//
	// An uncancelable dialog cannot simply swallow Escape — a modal with no way
	// out is worse than one that closes — so it resolves the same promise its OK
	// button does. What it must not do is *confirm* a cancelable one.
	dialog.addEventListener('cancel', e => {
		e.preventDefault();
		if (cancelable) cancel();
		else confirm();
	});
	dialog.addEventListener('close', () => { if (!settled) cancel(); });

	if (cancelable) {
		buttons.style.float = 'right';
		buttons.append(
			makeButton('cancel', 'button-right', cancel),
			makeButton('confirm', 'button-right', confirm, true),
		);
	} else {
		buttons.append(makeButton('ok', undefined, confirm, true));
	}

	dialog.showModal();
}));

export function makeButton(text: string, cls?: string, onClick?: () => void, focus?: boolean) {
	const btn = document.createElement('input');
	btn.setAttribute('type', 'button');
	btn.setAttribute('value', text);
	if (onClick) btn.addEventListener('click', onClick);
	if (cls) btn.classList.add(cls);
	// `showModal()` focuses the first focusable descendant itself, so this is only
	// about which button that is — and it has to happen after the element is in
	// the dialog, which it is not yet when this runs.
	if (focus) requestAnimationFrame(() => { btn.focus(); });
	return btn;
}
