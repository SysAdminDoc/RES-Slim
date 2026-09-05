/* @flow */

// The blacklist is one comma-separated option, which is fine for the four
// subreddits somebody types by hand and useless for the list they already have
// somewhere else. Upstream #5573 asks for bulk import; this is the reading half
// of it, kept out of the module so it can be tested against real input rather
// than asserted about from source.
//
// Nothing here writes. `inspectListImport` says what an import *would* do and
// `mergeSubredditList` produces the value to write; deciding and committing are
// two steps on purpose, the same shape `userTagger` uses, because a bulk edit
// that silently replaced a list is not recoverable from the settings page.

// Reddit's own rule: 2-21 characters, letters, digits and underscore. Checked
// rather than accepted, because a blacklist entry that can never match a
// subreddit is a line that looks like it is working and is not.
const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

// One entry, as the user might have written it. `r/pics`, `/r/pics`, a full URL
// and a bare name all mean the same subreddit, and a list copied out of a
// browser or another tool carries all four.
export function normalizeSubredditName(raw: mixed): ?string {
	if (typeof raw !== 'string') return null;
	let value = raw.trim();
	if (!value) return null;
	value = value.replace(/^https?:\/\/[^/]*reddit\.com/i, '');
	value = value.replace(/^\/?(?:r\/)/i, '');
	// A trailing slash from a pasted URL, and nothing else: anything left over
	// that is not a name should fail rather than be trimmed into one.
	value = value.replace(/\/+$/, '');
	return SUBREDDIT.test(value) ? value.toLowerCase() : null;
}

// The stored option, as a list. Split on commas *and* newlines, because a
// pasted list is one per line and the field it lands in is comma-separated.
export function parseSubredditList(raw: mixed): {| valid: string[], invalid: string[] |} {
	const valid = [];
	const invalid = [];
	const seen = new Set();
	for (const piece of String(raw === null || raw === undefined ? '' : raw).split(/[\n,]/)) {
		const trimmed = piece.trim();
		if (!trimmed) continue;
		const name = normalizeSubredditName(trimmed);
		if (!name) { invalid.push(trimmed); continue; }
		if (seen.has(name)) continue;
		seen.add(name);
		valid.push(name);
	}
	return { valid, invalid };
}

export type ListImportPreview = {|
	counts: {| valid: number, invalid: number, newEntries: number, duplicate: number |},
	incoming: string[],
	invalid: string[],
	error: ?string,
|};

// What importing this payload into that list would do, counted without writing.
export function inspectListImport(raw: mixed, currentRaw: mixed): ListImportPreview {
	const incoming = parseSubredditList(raw);
	const current = new Set(parseSubredditList(currentRaw).valid);

	const newEntries = incoming.valid.filter(name => !current.has(name));
	const counts = {
		valid: incoming.valid.length,
		invalid: incoming.invalid.length,
		newEntries: newEntries.length,
		duplicate: incoming.valid.length - newEntries.length,
	};

	let error = null;
	if (!String(raw === null || raw === undefined ? '' : raw).trim()) error = 'There is nothing to import.';
	else if (!incoming.valid.length) error = 'No line in that payload is a subreddit name.';

	return { counts, incoming: incoming.valid, invalid: incoming.invalid, error };
}

// The value to store. A merge, not a replacement: the existing list is what the
// reader built by hand and an import must not be able to delete it. Order is
// preserved so the field does not reshuffle itself under them.
export function mergeSubredditList(currentRaw: mixed, incoming: string[]): string {
	const current = parseSubredditList(currentRaw).valid;
	const merged = [...current];
	const seen = new Set(current);
	for (const name of incoming) {
		if (seen.has(name)) continue;
		seen.add(name);
		merged.push(name);
	}
	return merged.join(', ');
}
