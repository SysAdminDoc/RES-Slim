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
import { ajax } from '../environment';
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
const HIDDEN_ATTR = 'data-rsm-hidden-by-hide-all';

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

// Restores everything a run hid. Reported the same way as the hide itself so a
// failed undo cannot look like a successful one.
async function undo(hidden: Array<{| thing: Thing, fullname: string |}>, uh: string, perSecond: number) {
	const limiter = limiterFor(perSecond);
	let restored = 0;
	let failed = 0;

	await Promise.all(hidden.map(entry => limiter.schedule(async () => {
		try {
			await post('/api/unhide', entry.fullname, uh);
			setHidden(entry.thing, false);
			restored++;
		} catch (e) {
			failed++;
		}
	})));

	showNotification({
		moduleID: 'hideAll',
		notificationID: 'hideAll-undo',
		header: 'Hide all',
		message: `Restored ${restored} post${restored === 1 ? '' : 's'}.${failed ? ` ${failed} could not be restored — they are still hidden on reddit.` : ''}`,
	});
}

function buildResultMessage(hiddenCount: number, failed: number, onUndo: () => void): HTMLElement {
	const wrapper = document.createElement('div');
	const summary = document.createElement('p');
	summary.style.margin = '0 0 8px';
	summary.textContent = `Hid ${hiddenCount} post${hiddenCount === 1 ? '' : 's'}.${failed ? ` ${failed} failed — those are still visible.` : ''}`;
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
	}

	return wrapper;
}

async function hideAll(link: HTMLAnchorElement) {
	if (link.getAttribute('aria-busy') === 'true') return;

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
	const paint = () => { link.textContent = `hiding ${done}/${targets.length}…`; };
	paint();

	await Promise.all(targets.map(thing => limiter.schedule(async () => {
		const fullname = thing.getFullname();
		try {
			await post('/api/hide', fullname, uh);
			setHidden(thing, true);
			hidden.push({ thing, fullname });
		} catch (e) {
			failed++;
		}
		done++;
		paint();
	})));

	link.textContent = label;
	link.removeAttribute('aria-busy');

	showNotification({
		moduleID: 'hideAll',
		notificationID: 'hideAll-result',
		header: 'Hide all',
		message: buildResultMessage(hidden.length, failed, () => { undo(hidden, uh, perSecond); }),
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

module.contentStart = () => {
	if (!isPageType('linklist', 'search', 'profile')) return;
	injectLink();
};
