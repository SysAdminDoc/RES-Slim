/* @flow */

// What the extension did to the page in front of you.
//
// The most concrete thing readers asked for this quarter was a way to tell
// which filter is hiding a post, so they can trust their filters. The same gap
// covers everything else this extension does silently: an expando that was
// refused for a permission, a host in the penalty box, a promoted record
// removed. Each is a decision the reader never sees and cannot check.
//
// uBlock Origin's logger is the reference: a per-tab table of what matched,
// which rule did it, and what happened. This is the same idea at this
// extension's scale.
//
// In memory, per page, capped, and never persisted. A log of what you were
// reading is exactly the sort of thing that must not outlive the tab: it is
// dropped on navigation because it is a page-lifetime array and nothing writes
// it anywhere. The cap matters for a different reason -- infinite scroll turns
// "one entry per post" into an unbounded array on a session that never
// navigates, which is a leak with a friendly name.

export const ACTION_LOG_CAP = 500;

const MAX_FIELD_LENGTH = 200;

export type ActionOutcome = 'hidden' | 'dimmed' | 'collapsed' | 'badged' | 'removed' | 'built' | 'refused' | 'penalised' | 'restored';

export type ActionEntry = {|
	timestamp: number,
	moduleID: string,
	outcome: ActionOutcome,
	// What it happened to: a reddit fullname where there is one, else a host or a
	// URL. Never the post's text, which is the reader's content rather than a
	// decision about it.
	target: string,
	// Which rule or host decided it, where one did.
	reason: string,
	detail: string,
|};

function text(value: mixed, fallback: string = ''): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	return trimmed.length > MAX_FIELD_LENGTH ? `${trimmed.slice(0, MAX_FIELD_LENGTH - 1)}…` : trimmed;
}

const entries: ActionEntry[] = [];

export function recordAction(entry: {
	moduleID: string,
	outcome: ActionOutcome,
	target?: string,
	reason?: string,
	detail?: string,
	timestamp?: number,
}): ActionEntry {
	const recorded: ActionEntry = {
		timestamp: Number.isFinite(entry.timestamp) ? (entry.timestamp: any) : Date.now(),
		moduleID: text(entry.moduleID, 'unknown-module'),
		outcome: (text(entry.outcome, 'built'): any),
		target: text(entry.target),
		reason: text(entry.reason),
		detail: text(entry.detail),
	};

	entries.push(recorded);
	// Oldest first out. `splice` rather than `shift` in a loop so a burst that
	// arrives faster than the cap -- an infinite-scroll page appending two hundred
	// posts at once -- costs one operation rather than two hundred.
	if (entries.length > ACTION_LOG_CAP) entries.splice(0, entries.length - ACTION_LOG_CAP);
	return recorded;
}

// Newest first, because that is the order a reader wants to read it in: the
// thing that just happened is the thing they are asking about.
export function readActionLog(limit: number = ACTION_LOG_CAP): ActionEntry[] {
	const wanted = Math.max(0, Math.min(limit, entries.length));
	return entries.slice(entries.length - wanted).reverse();
}

export function actionLogSize(): number {
	return entries.length;
}

export function clearActionLog(): void {
	entries.length = 0;
}

// One line per entry, for the support report. Deliberately not the raw objects:
// a report is pasted into a bug tracker by a person, and a wall of JSON is worse
// than a table for the one thing it is for.
export function describeActionLog(limit: number = 50): string {
	const rows = readActionLog(limit);
	if (!rows.length) return 'Nothing recorded on this page.';
	return rows
		.map(row => {
			const when = new Date(row.timestamp).toISOString().slice(11, 19);
			const why = row.reason ? ` via ${row.reason}` : '';
			const extra = row.detail ? ` (${row.detail})` : '';
			return `${when}  ${row.moduleID}: ${row.outcome} ${row.target}${why}${extra}`;
		})
		.join('\n');
}
