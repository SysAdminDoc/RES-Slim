// @flow
import { JSAPI_CONSUMER_NAME } from '../constants/jsapi';
import type {
	CommentEventData, // eslint-disable-line no-unused-vars
	CommentAuthorEventData, // eslint-disable-line no-unused-vars
	PostAuthorEventData, // eslint-disable-line no-unused-vars
	PostEventData, // eslint-disable-line no-unused-vars
	SubredditEventData, // eslint-disable-line no-unused-vars
	UserHovercardEventData, // eslint-disable-line no-unused-vars
	PostModToolsEventData, // eslint-disable-line no-unused-vars
} from '../types/events';
import { Thing } from './Thing';
import { registerPage } from './watchers';
import { prepareShredditThing, prepareShredditTree, refreshShredditThing, SHREDDIT_THING_SELECTOR } from './shreddit';

const callbacks = {
	subreddit: [],
	postAuthor: [],
	post: [],
};

/* eslint-disable no-redeclare, no-unused-vars */
declare function watchForRedditEvents(type: 'comment', callback: (HTMLElement, CommentEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'subreddit', callback: (HTMLElement, SubredditEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'postAuthor', callback: (HTMLElement, PostAuthorEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'post', callback: (HTMLElement, PostEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'userHovercard', callback: (HTMLElement, UserHovercardEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'commentAuthor', callback: (HTMLElement, CommentAuthorEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'postModTools', callback: (HTMLElement, PostModToolsEventData) => void | Promise<void>): void;

export function watchForRedditEvents(type: $Keys<typeof callbacks>, callback) {
	if (!callbacks[type]) {
		callbacks[type] = [];
	}
	callbacks[type].push(callback);
}
/* eslint-enable no-redeclare */

function handleRedditEvent(event) {
	const { target, detail: { type, data } } = event;
	const fns = callbacks[type];
	if (!fns) {
		if (process.env.NODE_ENV === 'development') {
			console.warn('Unhandled reddit event type:', type);
		}
		return;
	}

	let expandoId = `${type}|`;
	switch (type) {
		case 'postAuthor':
			expandoId += data.post.id;
			break;
		case 'commentAuthor':
			expandoId += data.comment.id;
			break;
		case 'userHovercard':
			expandoId += `${data.contextId}|${data.user.id}`;
			break;
		case 'subreddit':
		case 'post':
		case 'postModTools':
		default:
			expandoId += data.id;
			break;
	}

	const update = target.expando && target.expando._.id === expandoId ?
		(target.expando._.update || 0) + 1 :
		0;

	const expando = {
		...data,
		_: {
			id: expandoId,
			type,
			update,
		},
	};

	target.expando = expando;

	const ownedTarget = target.querySelector(`[data-name="${JSAPI_CONSUMER_NAME}"]`);
	for (const fn of fns) {
		try {
			fn(ownedTarget, expando);
		} catch (e) {
			console.log(e);
		}
	}
}

export function initD2xWatcher() {
	document.addEventListener('reddit', (handleRedditEvent: any), true);
	const meta = document.createElement('meta');
	meta.name = 'jsapi.consumer';
	meta.content = JSAPI_CONSUMER_NAME;
	document.head.appendChild(meta);
	meta.dispatchEvent(new CustomEvent('reddit.ready'));

	// What counts as "the page changed" on current Reddit, and how it is noticed.
	//
	// It used to be noticed only from inside the MutationObserver below, so a
	// `pushState` that changed no DOM was never seen at all — and reddit does that,
	// because it swaps the URL before the new view renders. `popstate` was the only
	// other source, which covers the back button and nothing else.
	//
	// The Navigation API is the signal that actually exists for this:
	// `navigatesuccess` fires for pushState, replaceState *and* popstate. Verified
	// firing in a content script's isolated world, which is not a given — this
	// extension has already been caught assuming an API was there when
	// `customElements` turned out to be null in the same context. The observer and
	// `popstate` are kept as a backstop for a browser without it.
	//
	// The key is the URL plus what reddit says the page is. Every source runs
	// through it, so three of them noticing one navigation still emits one event,
	// and an authoritative `pagetype` that arrives after the URL — which is the
	// ordering on a real navigation — emits a second one that says the page type is
	// now known. That is the point: a module that sat out because the type was
	// still being guessed can be reconsidered.
	const routeKey = () => {
		const app = document.querySelector('shreddit-app');
		return [
			location.href,
			app ? app.getAttribute('pagetype') : null,
			app ? app.getAttribute('routename') : null,
		].join('|');
	};

	let previousRoute = routeKey();
	const notifyLocationChange = () => {
		const next = routeKey();
		if (next === previousRoute) return;
		previousRoute = next;
		document.dispatchEvent(new CustomEvent('reddit.urlChanged'));
	};
	const register = (root: ParentNode) => {
		const elements = prepareShredditTree(root);
		if (root instanceof HTMLElement) {
			const owner = root.closest(SHREDDIT_THING_SELECTOR);
			if (owner instanceof HTMLElement && !elements.includes(owner)) {
				prepareShredditThing(owner);
				elements.push(owner);
			}
		}
		for (const element of elements) {
			registerPage(element);
			const thing = Thing.from(element);
			if (thing) thing.runTasks();
		}
	};

	// contentStart/go handlers register their Thing watchers in this same turn.
	// Defer the first scan by one microtask so the initial posts reach them too.
	Promise.resolve().then(() => register(document.body));

	const observer = new MutationObserver(records => {
		notifyLocationChange();
		for (const record of records) {
			if (record.type === 'attributes') {
				const target = record.target;
				if (target instanceof HTMLElement) {
					const thing = target.matches(SHREDDIT_THING_SELECTOR) ? target : target.closest(SHREDDIT_THING_SELECTOR);
					// The cheap half. A live score tick does not need the shadow parts
					// re-exposed or nine selectors re-run; it needs the mirrored
					// attributes to say what the score now is. A thing that has never
					// had the full pass still gets it — `refreshShredditThing` reads
					// the compat attribute to tell the two apart.
					if (thing instanceof HTMLElement) refreshShredditThing(thing);
				}
				continue;
			}
			for (const node of record.addedNodes) {
				if (node instanceof HTMLElement) register(node);
			}
		}
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['score', 'comment-count', 'open', 'author', 'subreddit-name', 'domain'],
	});
	window.addEventListener('popstate', notifyLocationChange);

	// The one source that does not need a DOM mutation or a back button.
	if (typeof navigation !== 'undefined' && navigation && typeof navigation.addEventListener === 'function') {
		navigation.addEventListener('navigatesuccess', notifyLocationChange);
	}

	// `pagetype` and `routename` are the authoritative answer and arrive on the
	// existing element, so an attribute change is the only thing that reports them.
	const app = document.querySelector('shreddit-app');
	if (app) {
		new MutationObserver(notifyLocationChange)
			.observe(app, { attributes: true, attributeFilter: ['pagetype', 'routename'] });
	}
}
