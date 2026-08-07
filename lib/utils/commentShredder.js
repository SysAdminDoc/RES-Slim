/* @flow */

// Selection and overwrite logic for bulk-editing and deleting your own comments.
//
// This is the single largest gap in the old.reddit userscript ecosystem — the
// "Reddit Secure Delete" / "Reddit Overwrite" / "Spaz's Reddit Delete" /
// "Reddit History Sanitizer" family between them accounts for more installs than
// any other reddit userscript category. They all do the same two things: replace
// the body with junk so the edit is what gets archived, then delete.
//
// What they mostly get wrong is the part that cannot be undone. They operate on
// whatever comments happen to be rendered, offer no preview, and several ship
// with the filters commented out. So the rules here are:
//
//   * every predicate is pure and tested, because a wrong `shouldShred` deletes
//     the wrong comment and there is no undo;
//   * `planShred` records a reason for every skip, so the preview can show what
//     will survive rather than only what will die;
//   * nothing selects by default — an empty filter set selects nothing, not
//     everything. That inversion is the failure mode that makes these scripts
//     dangerous.

export type ShredItem = {|
	fullname: string,
	subreddit: string,
	body: string,
	score: number,
	createdUtc: number, // seconds, as reddit reports it
	permalink?: string,
	gilded?: boolean,
	stickied?: boolean,
	archived?: boolean,
|};

export type ShredOptions = {|
	olderThanDays: number,
	// 'deny' = shred everywhere except these subs; 'allow' = shred only in these.
	subredditMode: 'deny' | 'allow',
	subreddits: string[],
	keepScoreAtOrAbove: number | null,
	keepGilded: boolean,
	maxPerRun: number,
|};

export type ShredDecision = {|
	item: ShredItem,
	shred: boolean,
	reason: string,
|};

export const DEFAULT_OVERWRITE_TEXT = '.';

export function parseSubredditList(text: ?string): string[] {
	return String(text || '')
		.split(/[\s,]+/)
		.map(s => s.trim().replace(/^\/?r\//i, '').toLowerCase())
		.filter(Boolean);
}

// Reddit refuses edits on archived comments and on anything that is not yours.
// Both come back as a 200 with an error payload, so a run that ignores them
// reports success while changing nothing.
export function shouldShred(item: ShredItem, options: ShredOptions, nowMs: number): ShredDecision {
	const reject = (reason: string) => ({ item, shred: false, reason });

	if (item.archived) return reject('archived by reddit — reddit refuses edits and deletes');
	if (item.stickied) return reject('stickied');
	if (options.keepGilded && item.gilded) return reject('gilded');

	if (options.keepScoreAtOrAbove !== null && item.score >= options.keepScoreAtOrAbove) {
		return reject(`score ${item.score} is at or above the keep threshold`);
	}

	const ageDays = (nowMs - item.createdUtc * 1000) / 86400000;
	if (ageDays < options.olderThanDays) {
		return reject(`only ${Math.floor(ageDays)} day(s) old`);
	}

	const sub = String(item.subreddit || '').toLowerCase();
	if (options.subredditMode === 'allow') {
		// An empty allow list must select nothing. Selecting everything here is
		// the bug that makes the ecosystem scripts unsafe.
		if (!options.subreddits.length) return reject('no subreddits are on the allow list');
		if (!options.subreddits.includes(sub)) return reject(`r/${item.subreddit} is not on the allow list`);
	} else if (options.subreddits.includes(sub)) {
		return reject(`r/${item.subreddit} is on the keep list`);
	}

	return { item, shred: true, reason: 'matches every filter' };
}

export function planShred(items: ShredItem[], options: ShredOptions, nowMs: number): {|
	selected: ShredDecision[],
	skipped: ShredDecision[],
	cappedAt: number | null,
|} {
	const decisions = items.map(item => shouldShred(item, options, nowMs));
	const matched = decisions.filter(d => d.shred);
	const skipped = decisions.filter(d => !d.shred);

	const cap = Math.max(0, options.maxPerRun | 0);
	if (cap && matched.length > cap) {
		const overflow = matched.slice(cap).map(d => ({ ...d, shred: false, reason: `over the ${cap}-per-run cap` }));
		return { selected: matched.slice(0, cap), skipped: skipped.concat(overflow), cappedAt: cap };
	}

	return { selected: matched, skipped, cappedAt: null };
}

// The overwrite body. Reddit rejects an empty edit, collapses runs of
// whitespace, and treats a body identical to the previous one as a no-op, so the
// text has to be non-empty and has to differ between passes.
const WORDS = [
	'redacted', 'removed', 'overwritten', 'scrubbed', 'cleared', 'erased',
	'expunged', 'withdrawn', 'deleted', 'vacated',
];

export function overwriteBody(template: ?string, seed: number): string {
	const text = String(template === null || template === undefined ? '' : template).trim();
	if (text) {
		// A caller-supplied template still has to differ per comment, or a second
		// pass over the same comment is a no-op edit reddit silently drops.
		return text.includes('{n}') ? text.replace(/\{n\}/g, String(seed)) : `${text}\n\n^${seed}`;
	}
	const a = WORDS[seed % WORDS.length];
	const b = WORDS[(seed * 7 + 3) % WORDS.length];
	return `${a} ${b} ${seed}`;
}

// Parses one page of /user/<name>/comments.json into the shape above. Kept here
// rather than in the module so the field mapping is covered by tests — reddit
// renames fields often enough that a silent mapping change would select the
// wrong comments.
export function parseListing(json: any): {| items: ShredItem[], after: ?string |} {
	const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
	const items = children
		.map(child => (child && child.data) || null)
		.filter(Boolean)
		.filter(data => typeof data.name === 'string' && data.name.startsWith('t1_'))
		.map(data => ({
			fullname: data.name,
			subreddit: String(data.subreddit || ''),
			body: String(data.body || ''),
			score: Number.isFinite(data.score) ? data.score : 0,
			createdUtc: Number.isFinite(data.created_utc) ? data.created_utc : 0,
			permalink: typeof data.permalink === 'string' ? data.permalink : undefined,
			gilded: Boolean(data.gilded) || Boolean(data.all_awardings && data.all_awardings.length),
			stickied: Boolean(data.stickied),
			archived: Boolean(data.archived),
		}));

	const after = json && json.data && typeof json.data.after === 'string' ? json.data.after : null;
	return { items, after };
}

// The outcome of a run, and how it is described to the user.
//
// This is separated out and tested because the previous version told users the
// opposite of what had happened. The overwrite and the delete were made in the
// same `try`, so a comment whose overwrite succeeded and whose delete then failed
// — the likely shape, since a run makes hundreds of writes at 1-2/s and reddit
// 429s hard — was counted only as "failed" and reported as "left alone".
//
// It was not left alone. Its original text was permanently replaced with the
// tombstone and it is still publicly visible. Telling someone their content is
// intact when it has already been destroyed is the worst thing this module can
// get wrong, so the two failure modes are now distinct and named:
//
//   stranded  — overwritten, delete failed. Content is GONE, comment still there.
//   untouched — the overwrite itself failed. Genuinely unmodified.
export type ShredOutcome = {|
	overwritten: number,
	deleted: number,
	stranded: number,
	untouched: number,
	// Set when the user pressed Stop. `remaining` is what was never attempted:
	// the counts alone cannot distinguish "finished, nothing else matched" from
	// "stopped with most of the run still ahead of it".
	stopped?: boolean,
	remaining?: number,
|};

export function summariseOutcome(outcome: ShredOutcome): string {
	const { overwritten, deleted, stranded, untouched, stopped, remaining } = outcome;
	const parts = [];

	if (stopped) parts.push('Stopped.');
	parts.push(`Overwrote ${overwritten}, deleted ${deleted}.`);

	if (stopped && remaining) {
		parts.push(`${remaining} ${remaining === 1 ? 'was' : 'were'} not attempted. Run again to continue.`);
	}

	if (stranded) {
		parts.push(
			`${stranded} ${stranded === 1 ? 'was' : 'were'} overwritten but could not be deleted — ` +
			`the original text is gone and ${stranded === 1 ? 'it is' : 'they are'} still visible. ` +
			'Run again to finish removing them.',
		);
	}

	if (untouched) {
		parts.push(`${untouched} could not be overwritten and ${untouched === 1 ? 'was' : 'were'} left unchanged.`);
	}

	parts.push('Reload the page to see the result.');
	return parts.join(' ');
}
