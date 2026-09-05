/* @flow */

// The page-world half of the NSFW and spoiler reveal on current Reddit.
//
// Old Reddit hides a thumbnail by swapping the `src` for a flat placeholder and
// leaving the real preview URL on the row, so `nsfwThumbnails` can put it back
// from the document. Current Reddit does something else entirely: the post is
// wrapped in a Lit custom element that holds a `blurred` property and renders the
// blur itself. Nothing in the document can reach that, and CSS cannot either —
// the property decides, not a class.
//
// So this reaches the element's own prototype. `customElements.whenDefined(tag)`
// resolves before any instance exists, which is what makes it race-free: there is
// no window in which a post renders blurred before the hook is in place. The
// alternative everyone else reaches for — poll for the element, then retry once on
// a `requestAnimationFrame` — is documented breakage in three separate projects,
// because one frame is not a bound on when a custom element upgrades.
//
// It has to run in the page world. A Chrome content script's isolated world
// reports `customElements === null` (and `typeof` still answers `'object'`, which
// is how a guard on it passed while doing nothing), so the registry this needs is
// only reachable from a script the page itself loaded.
//
// Nothing here fetches. Every post it reveals is one Reddit already sent to the
// browser and then covered up; a post the server withheld is still not here, and
// the account-level "show me NSFW content" setting is untouched. The age gate on
// the way into a subreddit belongs to `frictionRemovers` and is not this.

// The elements current Reddit blurs, and the property on each that decides it.
//
// Read off the shipped markup rather than guessed. Each entry names the Lit
// lifecycle method to wrap, because they are not the same one on every element —
// wrapping `render` where the element only implements `update` installs a hook on
// a method that is never called, which is indistinguishable from working.
export const REVEAL_TARGETS = [
	// The wrapper around a blurred post, in a feed and on the post page. `reason`
	// is `nsfw` or `spoiler`, so one element serves both toggles.
	{ tag: 'shreddit-blurred-container', method: 'render', kind: 'reason', property: 'blurred', reveal: false },
	// The small cards in a subreddit's highlight strip.
	{ tag: 'community-highlight-card', method: 'render', kind: 'nsfw', property: 'isBlurred', reveal: false },
	// Devvit's own gate, which uses a private field rather than a public one.
	{ tag: 'devvit2-blur-gate', method: 'update', kind: 'nsfw', property: '_blur', reveal: false },
	// An inline text spoiler inside a comment or a self post.
	{ tag: 'shreddit-spoiler', method: 'render', kind: 'spoiler', property: 'revealed', reveal: true },
];

// The search results blur through a class instead of a property.
export const BLUR_CLASS = 'thumbnail-blur';
export const BLUR_CLASS_TAG = 'faceplate-img';

type RevealOptions = {| nsfw: boolean, spoiler: boolean |};

// True when this kind of blur is one the reader asked to see through.
export function wants(kind: string, reason: mixed, options: RevealOptions): boolean {
	if (kind === 'nsfw') return options.nsfw;
	if (kind === 'spoiler') return options.spoiler;
	// `reason` carries the answer for the element that serves both. An element
	// reporting a reason this does not know stays blurred: revealing on an
	// unrecognised value is the failure that shows somebody something they did not
	// ask for.
	if (reason === 'spoiler') return options.spoiler;
	if (reason === 'nsfw') return options.nsfw;
	return false;
}

// Wrap one method on a custom element's prototype so `before` runs first.
//
// A Proxy rather than an assignment, because the page keeps its own references:
// replacing the function outright is visible to anything that captured it, while
// a Proxy is the same object identity to every holder. `before` throwing must not
// stop the element rendering — a blurred post is a far better failure than a post
// that never appears.
export function patchPrototype(registry: any, tag: string, method: string, before: (instance: any) => void): Promise<void> {
	return registry.whenDefined(tag).then(ctor => {
		const target = ctor && ctor.prototype ? ctor.prototype[method] : null;
		if (typeof target !== 'function') return;
		// Wrapping twice would run `before` twice per render. Harmless here, but it
		// also means an injected-twice script keeps stacking proxies.
		if (target.__resSlimReveal) return;
		const wrapped = new Proxy(target, {
			apply(fn, thisArg, args) {
				try { before(thisArg); } catch (e) { /* never block a render */ }
				return Reflect.apply(fn, thisArg, args);
			},
		});
		// The whole install, not just the marker.
		//
		// Assigning to a prototype can throw on its own — a frozen prototype, or a
		// non-writable method — and this runs inside a `then`, so a throw here
		// becomes a rejected promise. Nothing awaits what `installReveal` returns
		// (the page-world entry has nowhere to report to), so that surfaces as an
		// unhandled rejection in the console of somebody's real reddit tab. And
		// marking the target is what the double-install guard reads, so letting
		// that half fail quietly while the assignment succeeded would stack a
		// second proxy on the next install rather than refuse it.
		try {
			// A Proxy forwards property reads to its target, so this marker is
			// readable through the wrapper and a second install sees it.
			Object.defineProperty(target, '__resSlimReveal', { value: true });
			ctor.prototype[method] = wrapped;
		} catch (e) {
			/* a prototype this cannot patch is a post that stays blurred, not an error */
		}
	}, () => { /* the page never defined it; nothing to reveal */ });
}

export function installReveal(scope: any, options: RevealOptions): Array<Promise<void>> {
	const registry = scope && scope.customElements;
	// Not `typeof registry === 'undefined'`: a content script's isolated world
	// answers `'object'` for a `customElements` that is `null`, which is exactly
	// how the last guard of this shape passed while reaching nothing.
	if (!registry || typeof registry.whenDefined !== 'function') return [];
	if (!options.nsfw && !options.spoiler) return [];

	const pending = REVEAL_TARGETS.map(({ tag, method, kind, property, reveal }) =>
		patchPrototype(registry, tag, method, instance => {
			if (!wants(kind, instance && instance.reason, options)) return;
			instance[property] = reveal;
		}));

	if (options.nsfw || options.spoiler) {
		pending.push(patchPrototype(registry, BLUR_CLASS_TAG, 'render', instance => {
			// This one carries no reason of its own; the surrounding search result
			// does, as tracking context. Both toggles are checked against it.
			const container = typeof instance.closest === 'function' ?
				instance.closest('[data-faceplate-tracking-context]') : null;
			const context = container ? container.getAttribute('data-faceplate-tracking-context') || '' : '';
			const isSpoiler = context.includes('"spoiler":true');
			const isNsfw = context.includes('"nsfw":true');
			if (!(isSpoiler && options.spoiler) && !(isNsfw && options.nsfw)) return;
			if (instance.classList) instance.classList.remove(BLUR_CLASS);
		}));
	}

	return pending;
}
