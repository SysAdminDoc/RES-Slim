// `Alert` is a modal, so Escape has to mean no.
//
// The version this covers replaced a hand-rolled overlay whose Escape handler
// *confirmed* when the dialog was not cancelable — the gesture every user reads
// as "no" could mean "yes", on a dialog whose only button said OK. It also had
// no role, no aria-modal, no focus trap and no focus restore.
//
// jsdom 30 parses `<dialog>` and implements none of its behaviour — no
// `showModal`, no `close`, no `open` reflection — so `loadModule` shims the
// state and the `close` event, and nothing more. What that leaves checkable is
// the part this repo owns: which promise settles, and when. The top layer, the
// focus trap, the inertness of the page behind it and Escape being routed to a
// `cancel` event are the browser's, are not reproduced here, and are asserted
// against a real browser in tests/e2e/extension.test.mjs.

import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/loadModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const Bundle = await loadModule('lib/modules/frictionRemovers.js', 'alert-dialog', {
	dom: { url: 'https://old.reddit.com/r/all/', html: '<!doctype html><html xmlns="http://www.w3.org/1999/xhtml"><body><button id="invoker">open</button></body></html>' },
	alsoExport: { alert: 'lib/utils/alert.js' },
});
const Alert = Bundle.alert;

function freshPage() {
	document.body.innerHTML = '<button id="invoker">open</button>';
}

const dialog = () => document.querySelector('dialog#alert_message');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function pressEscape(target) {
	// The platform turns Escape on an open modal dialog into a `cancel` event.
	// jsdom does not, so the event is dispatched directly — this test is about
	// what the handler does with it, not about the browser's key routing.
	target.dispatchEvent(new window.Event('cancel', { cancelable: true }));
}

test('a cancelable dialog treats Escape as no', async () => {
	freshPage();
	let outcome = 'pending';
	const promise = Alert.open('Delete everything?', { cancelable: true })
		.then(() => { outcome = 'confirmed'; }, () => { outcome = 'cancelled'; });
	await settle();

	const el = dialog();
	assert.ok(el, 'Alert must render a <dialog>, not a positioned div');
	assert.equal(el.open, true, 'and it must be open');

	pressEscape(el);
	await promise;

	assert.equal(outcome, 'cancelled', 'Escape on a cancelable dialog must reject — this used to resolve, so the dismissal gesture meant yes');
	assert.equal(dialog(), null, 'and the dialog leaves the document');
});

test('an uncancelable dialog closes on Escape rather than trapping the user', async () => {
	freshPage();
	let outcome = 'pending';
	const promise = Alert.open('Something happened.').then(() => { outcome = 'confirmed'; }, () => { outcome = 'cancelled'; });
	await settle();

	pressEscape(dialog());
	await promise;

	// There is no "no" to express here — the only button says OK — so resolving is
	// the same answer the button gives. A modal with no way out would be worse.
	assert.equal(outcome, 'confirmed');
	assert.equal(dialog(), null);
});

test('the buttons still mean what they say', async () => {
	freshPage();
	let outcome = 'pending';
	const promise = Alert.open('Delete everything?', { cancelable: true })
		.then(() => { outcome = 'confirmed'; }, () => { outcome = 'cancelled'; });
	await settle();

	const buttons = [...dialog().querySelectorAll('input[type="button"]')].map(b => b.value);
	assert.deepEqual(buttons, ['cancel', 'confirm'], 'cancel first, so the destructive option is not the one under the cursor');

	dialog().querySelector('input[value="confirm"]').click();
	await promise;
	assert.equal(outcome, 'confirmed');
});

test('closing the dialog by any other means is not agreement', async () => {
	freshPage();
	let outcome = 'pending';
	const promise = Alert.open('Delete everything?', { cancelable: true })
		.then(() => { outcome = 'confirmed'; }, () => { outcome = 'cancelled'; });
	await settle();

	// `dialog.close()` from anywhere — a page script, a devtools poke, a future
	// caller holding the element. Nothing about that is a yes.
	dialog().close();
	await promise;
	assert.equal(outcome, 'cancelled');
});

test('focus returns to whatever opened the dialog', async () => {
	freshPage();
	const invoker = document.querySelector('#invoker');
	invoker.focus();
	assert.equal(document.activeElement, invoker);

	const promise = Alert.open('Something happened.').then(() => {}, () => {});
	await settle();

	// The browser moves focus into the dialog; the shim does not, and without
	// that step this assertion holds whether or not the restore exists — focus
	// simply never left. Moved explicitly so the restore is what is measured.
	const ok = dialog().querySelector('input[value="ok"]');
	ok.focus();
	assert.equal(document.activeElement, ok, 'sanity: focus is inside the dialog before it closes');

	ok.click();
	await promise;

	assert.equal(document.activeElement, invoker, 'a modal that drops focus on the body leaves a keyboard user at the top of the page');
});

test('a dialog opened from a control that then disappears does not throw', async () => {
	freshPage();
	const invoker = document.querySelector('#invoker');
	invoker.focus();

	const promise = Alert.open('Something happened.').then(() => {}, () => {});
	await settle();
	invoker.remove();
	dialog().querySelector('input[value="ok"]').click();

	await promise;
	assert.equal(dialog(), null, 'the common case for a confirm dialog is an action that removes its own trigger');
});

test('the dialog announces itself as one', async () => {
	freshPage();
	const promise = Alert.open('Something happened.').then(() => {}, () => {});
	await settle();

	const el = dialog();
	assert.equal(el.tagName, 'DIALOG');
	assert.equal(el.getAttribute('aria-modal'), 'true');

	dialog().querySelector('input[value="ok"]').click();
	await promise;
});

// Comments stripped first: both files explain the overlay they replaced by
// naming it, and a scanner that trips over the note describing the fix is the
// same class of bug it exists to catch.
function stripComments(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(/\r?\n/).map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1')).join('\n');
}

test('the modal is opened with showModal, and the hand-rolled overlay is gone', () => {
	const source = stripComments(read('lib/utils/alert.js'));
	assert.match(source, /dialog\.showModal\(\)/, 'showModal is what supplies the focus trap, the inertness and the top layer');
	assert.ok(!/alert_message_background/.test(source), 'the second fixed-position div was the hand-rolled backdrop');
	assert.ok(!/addEventListener\('keyup', listenForEscape\)/.test(source), 'Escape is the platform\'s to route, not ours to intercept');

	const css = stripComments(read('lib/css/res.scss'));
	assert.match(css, /dialog#alert_message/);
	assert.match(css, /&::backdrop/, 'the backdrop comes from the platform now');
	assert.ok(!/#alert_message_background/.test(css), 'and its stylesheet half goes with it');
	assert.ok(!/\$zindex-alert-message/.test(css), 'a top-layer element needs no z-index at all');
});
