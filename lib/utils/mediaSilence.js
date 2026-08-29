/* @flow */

// Stop the sound when something is filtered out of view.
//
// `display: none` removes an element from the layout. It does not stop a
// `<video>` or an `<audio>` inside it, so filtering a subreddit while one of its
// posts was playing left the audio running with nothing on screen to pause. The
// three modules that hide a post - `filterRules`, `scopedFilters` and
// `subredditBlacklist` - each did it with a bare style assignment, so each had
// the bug independently. Upstream reports it as #5567 against their own filter
// UI, which this fork does not ship; the defect is in the replacement.
//
// Two kinds of playing media are not a `<video>` this file can pause.
//
// The first is an expando this extension opened. It owns a `Media` instance that
// already knows how to shut itself up — for an embedded player, by posting the
// pause command that host understands — and it has a collapse lifecycle that
// re-expanding rebuilds from. Reaching it from here needs a seam, because
// `showImages` imports from `lib/utils/`, so importing it back would be a cycle.
// `registerExpandoCollapser` is that seam: `showImages` fills it in when it
// loads, and this file does nothing about expandos until it does.
//
// The second is a third-party `<iframe>` nobody registered a pause command for.
// It is left playing, on purpose. The only generic way to stop one is to drop or
// reload the frame, and a filter hides a post the user may unhide a moment
// later — trading a stuck sound for a permanently empty box is the worse of two
// bad outcomes, and it is the user's own filter that produced the sound.
//
// `hiddenMediaCount` exists so a test can prove this ran rather than inferring it
// from a style attribute.

type ExpandoCollapser = (element: Element) => number;

let collapseExpandosWithin: ?ExpandoCollapser = null;

// Called once by `showImages`. Not a general plugin point: there is one producer
// and one consumer, and the indirection exists only to keep `lib/utils/` from
// importing a module.
export function registerExpandoCollapser(collapser: ExpandoCollapser) {
	collapseExpandosWithin = collapser;
}

// Duck-typed rather than `instanceof HTMLMediaElement`. An element that came
// from another realm - a document created by `DOMParser`, an adopted node - is
// not an instance of *this* realm's constructor, and the check would silently
// skip it while looking correct.
function isMedia(node: any): boolean {
	if (!node || typeof node.pause !== 'function') return false;
	const tag = String(node.tagName || '').toLowerCase();
	return tag === 'video' || tag === 'audio';
}

export function silenceWithin(element: ?Element): number {
	if (!element) return 0;

	// `any` because the whole point of `isMedia` is that Flow's `HTMLMediaElement`
	// refinement is the wrong tool here: `querySelectorAll` is typed as
	// `NodeList<HTMLElement>`, and an `instanceof` narrowing would reintroduce the
	// cross-realm hole the duck test exists to avoid.
	const media: any[] = [];
	if (isMedia(element)) media.push(element);
	for (const node of element.querySelectorAll('video, audio')) {
		if (isMedia(node)) media.push(node);
	}

	let silenced = 0;
	for (const node of media) {
		// `paused` is already true for a stream that has ended, and pausing one
		// again is harmless, so this check is only here to keep the count honest.
		if (node.paused) continue;
		try {
			node.pause();
			silenced++;
		} catch (e) {
			// A media element detached mid-call is not worth failing a filter over.
		}
	}

	// After the native pass, so a `<video>` an expando owns is already stopped if
	// collapsing it turns out to throw.
	if (collapseExpandosWithin) {
		try {
			silenced += collapseExpandosWithin(element);
		} catch (e) {
			// One misbehaving expando must not stop a filter from hiding the post.
			console.error('RES-Slim: could not collapse an expando while hiding', e);
		}
	}

	return silenced;
}

// Hide a thing and stop whatever it was playing. One call so a new filter cannot
// pick up only half of it.
export function hideAndSilence(element: ?HTMLElement): number {
	if (!element) return 0;
	const silenced = silenceWithin(element);
	element.style.display = 'none';
	return silenced;
}
