/* @flow */
// RES-Slim: dim the posts you have already opened.
//
// Concept from "Reddit visited link remover" (Greasy Fork 386988). Chrome
// deliberately hides `:visited` state from script and restricts which properties
// it may set, so on a dark theme the visited colour is often indistinguishable
// from the unvisited one — which is why so many of these scripts exist and why
// most of them ask for the browsing-history permission to work around it.
//
// This asks for nothing. The store is local, holds only reddit post fullnames
// and a timestamp, and is pruned. It is also the local visited-set that lets the
// `history` permission come out of both manifests.

import { Module } from '../core/module';
import { Storage } from '../environment';
import { Thing, isPageType, watchForThings } from '../utils';
import { DEFAULT_EXPIRE_DAYS, fullnameFromCommentsUrl, isPostFullname, pruneVisited } from '../utils/visitedPosts';

export const module: Module<*> = new Module('visitedPosts');

module.moduleName = 'Mark visited posts';
module.category = 'browsingCategory';
module.description = 'Remembers which posts you have opened and dims or hides them in later listings. The record is local to this browser and holds nothing but post IDs and timestamps — no browsing-history permission is involved.';
module.descriptionRaw = true;
module.include = ['linklist', 'search', 'profile', 'commentsLinklist', 'comments'];
module.disabledByDefault = true;
module.keywords = ['visited', 'read', 'seen', 'dim', 'hide', 'history'];

module.options = {
	treatment: {
		type: 'enum',
		value: 'dim',
		values: [
			{ name: 'Dim them', value: 'dim' },
			{ name: 'Hide them entirely', value: 'hide' },
			{ name: 'Just add a marker', value: 'mark' },
		],
		title: 'What to do with a visited post',
		description: 'Hiding is the strongest, but a listing where most posts vanish can look broken. Dimming is the safe default.',
	},
	dimOpacity: {
		type: 'text',
		value: '0.45',
		title: 'Dim level',
		description: 'Between 0.1 and 1. Only used by the dim treatment.',
	},
	expireDays: {
		type: 'text',
		value: String(DEFAULT_EXPIRE_DAYS),
		title: 'Forget after (days)',
		description: 'An unbounded visited list grows into a performance problem; entries older than this are dropped.',
	},
};

const store = Storage.wrapBlob('RESmodules.visitedPosts.seen', (): number => 0);
const ATTR = 'data-rsm-visited';

// Filled once per page load from a single getAll(), so decorating a 100-post
// listing is one storage read rather than 100.
let seen: { [string]: number } = {};
let loaded = false;
// The store read is async but the watcher must be registered synchronously or it
// misses everything already on the page — a contract test enforces that. So
// things that arrive before the read resolves are parked here and drained after.
const pending: Thing[] = [];

function decorate(thing: Thing) {
	if (!loaded) { pending.push(thing); return; }

	const el = thing.element;
	if (!(el instanceof HTMLElement) || el.hasAttribute(ATTR)) return;

	const fullname = thing.getFullname();
	if (!isPostFullname(fullname) || !Object.hasOwn(seen, fullname)) return;

	el.setAttribute(ATTR, '1');

	switch (module.options.treatment.value) {
		case 'hide':
			el.style.display = 'none';
			break;
		case 'mark':
			break;
		case 'dim':
		default: {
			const raw = parseFloat(module.options.dimOpacity.value);
			const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0.1, raw)) : 0.45;
			el.style.opacity = String(opacity);
			break;
		}
	}

	const title = el.querySelector('a.title');
	if (title instanceof HTMLElement) title.title = 'You have opened this post before';
}

function remember(fullname: ?string) {
	if (!isPostFullname(fullname)) return;
	seen[(fullname: any)] = Date.now();
	store.set((fullname: any), Date.now());
}

// A click on the comments link, the title of a self post, or the rank number all
// mean "opening this". Listening on the document rather than per-row keeps this
// working for rows infiniteScroll adds later.
function watchClicks() {
	document.addEventListener('mousedown', (e: MouseEvent) => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const anchor = target.closest('a[href]');
		if (!(anchor instanceof HTMLAnchorElement)) return;

		const fromUrl = fullnameFromCommentsUrl(anchor.getAttribute('href'));
		if (fromUrl) { remember(fromUrl); return; }

		// Not a comments link — but if the click landed inside a post row and the
		// row's own link was followed, that still counts as opening the post.
		const row = target.closest('.thing');
		if (row instanceof HTMLElement && anchor.classList.contains('title')) {
			remember(row.getAttribute('data-fullname'));
		}
	}, { capture: true, passive: true });
}

module.contentStart = () => {
	watchClicks();

	// Reading a thread is the strongest possible signal that the post was opened,
	// and it covers arrivals that did not come from a listing click.
	if (isPageType('comments')) {
		remember(fullnameFromCommentsUrl(location.pathname));
		return;
	}

	watchForThings(['post'], decorate);

	store.getAll().then(all => {
		seen = all;
		loaded = true;
		while (pending.length) decorate((pending.shift(): any));

		// Prune on roughly one page load in ten, matching commentHighlights.
		if (Math.random() < 0.1) {
			const expireDays = parseFloat(module.options.expireDays.value);
			const { map } = pruneVisited(seen, expireDays, Date.now());
			for (const key of Object.keys(seen)) {
				if (!Object.hasOwn(map, key)) store.delete(key);
			}
			seen = map;
		}
	});
};
