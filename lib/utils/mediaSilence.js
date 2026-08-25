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
// Deliberately limited to media elements the page owns. A third-party embed in an
// `<iframe>` can only be paused by posting the command that player understands,
// which `showImages` knows per host and a filter module does not; the only
// generic alternative is to reload or drop the frame, and neither is something to
// do to a post the user may unhide a moment later. `hiddenMediaCount` exists so a
// test can prove this ran rather than inferring it from a style attribute.

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
