/* @flow */
// RES-Slim: bulk-hide every post on the current listing.
//
// Rewritten from Douglas Beck's 2010 "Reddit Hide All" userscript (Greasy Fork
// 6544), which is kept in the repo root for reference. Only the idea survives:
// the original injected a <script> element into the page to borrow reddit's own
// jQuery helpers (`$.thing_id()`, `get_form_fields`, `reddit.modhash`), fired
// one unthrottled POST per post, and reported "None Found." through `alert()`.
//
// None of that fits here. RES-Slim talks to /api/hide through its own ajax
// helper, reads the modhash the same way markAllRead does, throttles through the
// shared rate limiter — the original author's own comment complained about the
// request volume — and reports through the notification surface. Because every
// hide is reversible via /api/unhide, the result notification offers Undo rather
// than asking for confirmation up front.

import { Module } from '../core/module';
import { Thing, isPageType, loggedInUserHash, string } from '../utils';
import { findSurface } from '../core/dom/selectors';
import { ajax, Storage } from '../environment';
import { createRateLimiter } from '../utils/rateLimiter';
import { showNotification } from './notifications';

export const module: Module<*> = new Module('hideAll');

module.moduleName = 'Hide all posts';
module.category = 'browsingCategory';
module.description = 'Adds a "hide all" link to the listing tab menu that hides every post on the page in one go. Hidden posts can be restored from the notification, or from your reddit hidden-posts page.';
module.descriptionRaw = true;
module.include = ['linklist', 'search', 'profile'];
module.disabledByDefault = true;
module.keywords = ['hide', 'bulk', 'listing', 'clear', 'mark'];

module.options = {
	skipStickied: {
		type: 'boolean',
		value: true,
		title: 'Skip stickied posts',
		description: 'Leave announcement and stickied posts visible when hiding everything else.',
	},
	requestsPerSecond: {
		type: 'enum',
		value: '3',
		values: [
			{ name: 'Gentle (2 per second)', value: '2' },
			{ name: 'Normal (3 per second)', value: '3' },
			{ name: 'Fast (6 per second)', value: '6' },
		],
		title: 'Request rate',
		description: 'How quickly to send hide requests. Reddit rate-limits bulk actions, so slower is safer on long listings.',
	},
};

const LINK_CLASS = 'rsm-hideAll-link';
const UNDO_LINK_CLASS = 'rsm-hideAll-undo-link';
const HIDDEN_ATTR = 'data-rsm-hidden-by-hide-all';

// How long the undo stays available. The undo used to live in a closure over an
// in-memory array, offered from a notification that closed after fifteen
// seconds — so hiding a hundred posts by accident was recoverable for fifteen
// seconds, and not at all after a reload or a click through to a comment page,
// which is exactly what a user does next. The set is a list of fullnames, which
// is all /api/unhide needs, so it survives a reload perfectly well.
const UNDO_WINDOW_MS = 30 * 60 * 1000;

type HideRun = {| fullnames: string[], at: number |};

// `wrap`'s second argument is the default *value*, not a factory — the
// nearby snapshot.js call passes an arrow and only gets away with it because it
// never awaits the result.
const lastRunStorage = Storage.wrap('RES.hideAll.lastRun', (null: ?HideRun));

async function readRecentRun(): Promise<?HideRun> {
	const run = await lastRunStorage.get();
	if (!run || !Array.isArray(run.fullnames) || !run.fullnames.length) return null;
	if (!Number.isFinite(run.at) || Date.now() - run.at > UNDO_WINDOW_MS) return null;
	return run;
}

// One limiter per run so a rate change in settings takes effect on the next use.
function limiterFor(perSecond: number) {
	return createRateLimiter({ tokens: perSecond, refillMs: Math.round(1000 / perSecond), maxConcurrent: 2 });
}

// Uses the shared helper rather than reading `input[name=uh]` directly: it tries
// that same input first, then falls back to /api/me.json, which is the only route
// that works on pages where reddit renders no hide/save form. A content script
// cannot read the page's own `reddit.modhash` — that lives in the page world.
function modhash(): Promise<?string> {
	return loggedInUserHash();
}

// A thing is a candidate when it is a real, visible post that reddit has not
// already hidden and that we have a fullname for — /api/hide needs the fullname.
function candidates(): Thing[] {
	const skipStickied = module.options.skipStickied.value !== false;
	return Thing.visibleThings(document).filter(thing => {
		if (!thing.isPost()) return false;
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return false;
		if (!thing.getFullname()) return false;
		if (el.classList.contains('hidden')) return false;
		if (el.hasAttribute(HIDDEN_ATTR)) return false;
		if (skipStickied && el.classList.contains('stickied')) return false;
		return true;
	});
}

function setHidden(thing: Thing, hidden: boolean) {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	if (hidden) {
		el.setAttribute(HIDDEN_ATTR, '1');
		el.style.display = 'none';
	} else {
		el.removeAttribute(HIDDEN_ATTR);
		el.style.display = '';
	}
}

async function post(endpoint: string, fullname: string, uh: string): Promise<void> {
	await ajax({
		method: 'POST',
		url: endpoint,
		headers: { 'X-Modhash': uh },
		data: { id: fullname, uh },
	});
}

// The visible post carrying a fullname, if it is on this page at all. After a
// reload or a navigation the `Thing` objects a run closed over are gone, but the
// unhide itself only ever needed the fullname — so the request is authoritative
// and the DOM update is best-effort on whatever happens to be here.
function thingForFullname(fullname: string): ?Thing {
	return Thing.visibleThings(document).find(thing => thing.getFullname() === fullname) || null;
}

// Restores everything a run hid. Reported the same way as the hide itself so a
// failed undo cannot look like a successful one.
async function undo(fullnames: string[], uh: string, perSecond: number) {
	const limiter = limiterFor(perSecond);
	let restored = 0;
	let failed = 0;

	await Promise.all(fullnames.map(fullname => limiter.schedule(async () => {
		try {
			await post('/api/unhide', fullname, uh);
			const thing = thingForFullname(fullname);
			if (thing) setHidden(thing, false);
			restored++;
		} catch (e) {
			failed++;
		}
	})));

	// Only drop the stored run once nothing is left to retry. A partial failure
	// keeps the offer alive, which is the whole point of persisting it.
	if (!failed) await lastRunStorage.delete();
	removeUndoLink();

	showNotification({
		moduleID: 'hideAll',
		notificationID: 'hideAll-undo',
		header: 'Hide all',
		message: `Restored ${restored} post${restored === 1 ? '' : 's'}.${failed ? ` ${failed} could not be restored — they are still hidden on reddit. Use "undo hide all" again to retry.` : ''}`,
	});
}

async function runUndo(fullnames: string[]) {
	const uh = await modhash();
	if (!uh) {
		showNotification({
			moduleID: 'hideAll',
			notificationID: 'hideAll-undo-nomodhash',
			header: 'Hide all',
			message: 'Couldn’t restore anything: RES-Slim could not read your login token. Reload the page and try again.',
		});
		return;
	}
	await undo(fullnames, uh, parseInt(module.options.requestsPerSecond.value, 10) || 3);
}

function buildResultMessage(hiddenCount: number, failed: number, skipped: number, onUndo: () => void): HTMLElement {
	const wrapper = document.createElement('div');
	const summary = document.createElement('p');
	summary.style.margin = '0 0 8px';
	summary.textContent = [
		`Hid ${hiddenCount} post${hiddenCount === 1 ? '' : 's'}.`,
		failed ? ` ${failed} failed — those are still visible.` : '',
		skipped ? ` Stopped before ${skipped} more.` : '',
	].join('');
	wrapper.append(summary);

	if (hiddenCount) {
		const undoBtn = document.createElement('button');
		undoBtn.type = 'button';
		undoBtn.className = 'RESNotificationButtonBlue';
		undoBtn.textContent = 'Undo';
		undoBtn.addEventListener('click', () => {
			undoBtn.disabled = true;
			undoBtn.textContent = 'Restoring…';
			onUndo();
		}, { once: true });
		wrapper.append(undoBtn);

		const note = document.createElement('p');
		note.style.margin = '8px 0 0';
		note.textContent = 'This notification closes shortly, but "undo hide all" stays in the tab menu for 30 minutes and survives a reload.';
		wrapper.append(note);
	}

	return wrapper;
}

// Set for the duration of a run so the same link can stop it. Null when idle.
let abortCurrentRun: ?() => void = null;

async function hideAll(link: HTMLAnchorElement) {
	// A second click during a run is a request to stop, not a no-op. Previously
	// there was no way to stop at all: the whole listing went into one
	// `Promise.all` and the only control on the page ignored you while it ran.
	if (link.getAttribute('aria-busy') === 'true') {
		if (abortCurrentRun) abortCurrentRun();
		return;
	}

	const targets = candidates();
	if (!targets.length) {
		showNotification({
			moduleID: 'hideAll',
			notificationID: 'hideAll-empty',
			header: 'Hide all',
			message: 'Nothing left to hide on this page.',
		});
		return;
	}

	const uh = await modhash();
	if (!uh) {
		// Without a modhash reddit either ignores the POST or answers 403, and in
		// both cases the posts stay visible while the run looks like it worked.
		// Same reasoning as markAllRead: fail loudly.
		showNotification({
			moduleID: 'hideAll',
			notificationID: 'hideAll-nomodhash',
			header: 'Hide all',
			message: 'Couldn’t hide anything: RES-Slim could not read your login token. Reload the page and try again, or check that you are still signed in.',
		});
		return;
	}

	const perSecond = parseInt(module.options.requestsPerSecond.value, 10) || 3;
	const limiter = limiterFor(perSecond);
	const label = link.textContent;
	link.setAttribute('aria-busy', 'true');

	const hidden = [];
	let done = 0;
	let failed = 0;
	let skipped = 0;
	// A run over a long listing is hundreds of writes and, until now, had no way
	// out at all: the whole set went into one `Promise.all` and the only control
	// on the page refused to do anything while busy. Clicking it again now stops
	// the run — checked inside each scheduled task, so queued work that has not
	// been sent is dropped rather than merely ignored.
	let stopRequested = false;
	abortCurrentRun = () => { stopRequested = true; };

	const paint = () => {
		link.textContent = stopRequested ?
			`stopping… ${done}/${targets.length}` :
			`hiding ${done}/${targets.length} — click to stop`;
	};
	paint();

	await Promise.all(targets.map(thing => limiter.schedule(async () => {
		if (stopRequested) { skipped++; return; }
		const fullname = thing.getFullname();
		try {
			await post('/api/hide', fullname, uh);
			setHidden(thing, true);
			hidden.push(fullname);
		} catch (e) {
			failed++;
		}
		done++;
		paint();
	})));

	abortCurrentRun = null;
	link.textContent = label;
	link.removeAttribute('aria-busy');

	if (hidden.length) {
		await lastRunStorage.set({ fullnames: hidden, at: Date.now() });
		injectUndoLink(hidden);
	}

	showNotification({
		moduleID: 'hideAll',
		notificationID: 'hideAll-result',
		header: 'Hide all',
		message: buildResultMessage(hidden.length, failed, skipped, () => { runUndo(hidden); }),
		closeDelay: 15000,
	});
}

function injectLink(): void {
	// Through the surface map so a renamed header class falls back instead of
	// silently dropping the control.
	const list = findSurface('header');
	if (!(list instanceof HTMLElement)) return;
	if (list.querySelector(`.${LINK_CLASS}`)) return;

	const item = document.createElement('li');
	item.className = LINK_CLASS;
	const link = string.html`<a href="#" role="button">hide all</a>`;
	link.setAttribute('aria-label', 'Hide every post on this page');
	link.title = 'Hide every post on this page. You can undo it from the notification.';
	link.addEventListener('click', (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		hideAll((link: any));
	});
	item.append(link);

	// The original userscript put this first in the list, ahead of the sort tabs.
	list.insertBefore(item, list.firstElementChild);
}

function removeUndoLink(): void {
	for (const el of document.querySelectorAll(`.${UNDO_LINK_CLASS}`)) el.remove();
}

// The durable half of undo. The notification is a convenience that closes in
// fifteen seconds; this is the offer that is still there after the user has
// clicked through to a comment page and come back, which is when they realise
// they hid the wrong listing.
function injectUndoLink(fullnames: string[]): void {
	const list = findSurface('header');
	if (!(list instanceof HTMLElement)) return;
	removeUndoLink();

	const item = document.createElement('li');
	item.className = UNDO_LINK_CLASS;
	const link = string.html`<a href="#" role="button">undo hide all</a>`;
	const count = fullnames.length;
	link.setAttribute('aria-label', `Restore the ${count} post${count === 1 ? '' : 's'} hidden by the last run`);
	link.title = `Restore the ${count} post${count === 1 ? '' : 's'} the last "hide all" hid. Available for 30 minutes.`;
	link.addEventListener('click', (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		if (link.getAttribute('aria-busy') === 'true') return;
		link.setAttribute('aria-busy', 'true');
		link.textContent = 'restoring…';
		runUndo(fullnames);
	});
	item.append(link);

	const anchor = list.querySelector(`.${LINK_CLASS}`);
	if (anchor && anchor.nextSibling) list.insertBefore(item, anchor.nextSibling);
	else list.insertBefore(item, list.firstElementChild);
}

module.contentStart = () => {
	if (!isPageType('linklist', 'search', 'profile')) return;
	injectLink();
	// Restores the offer after a reload or a navigation, which is the case the
	// in-memory version could not cover at all.
	readRecentRun().then(run => { if (run) injectUndoLink(run.fullnames); });
};
