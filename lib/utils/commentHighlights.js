/* @flow */
// Pure helpers for the commentHighlights module. Dependency-free for unit testing.

// A stored positive timestamp means the thread has been visited before. On the
// very first visit there is no stored value (null / undefined / 0), so nothing
// should be highlighted — otherwise every comment (all newer than epoch 0) reads
// as "new". Highlighting must only happen on a genuine revisit.
export function isRevisit(lastVisit: mixed): boolean {
	return typeof lastVisit === 'number' && Number.isFinite(lastVisit) && lastVisit > 0;
}

// Whether a comment posted at `commentTime` (ms since epoch) counts as new — i.e.
// posted after the last visit. Returns false on a first visit (no revisit) so a
// missing history never highlights the whole thread.
export function isNewComment(commentTime: mixed, lastVisit: mixed): boolean {
	if (!isRevisit(lastVisit)) return false;
	return typeof commentTime === 'number' && Number.isFinite(commentTime) && commentTime > Number(lastVisit);
}
