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
// reading is exactly the sort of thing that must not outlive the tab, so it is
// a page-lifetime array and nothing writes it anywhere.
//
// "Per page" is free on old Reddit, where a navigation replaces the document,
// and is not free on current Reddit, which is a single page application whose
// document lives for the whole session. `settingsNavigation` clears this on a
// route change for that reason; without it the ring would span every subreddit
// and profile visited, which is the thing it is meant not to be.
//
// The cap matters for a different reason -- infinite scroll turns "one entry per
// post" into an unbounded array on a session that never navigates, which is a
// leak with a friendly name.

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
	// A non-finite limit used to return the whole log: `Math.min(NaN, n)` is NaN,
	// and `slice(n - NaN)` is `slice(0)`. The one live caller launders its input
	// through `Number(x) || 200` first, so this was latent -- but a read whose
	// cap silently becomes "everything" is the wrong way round for a limit.
	const requested = Number.isFinite(limit) ? Math.floor(limit) : 0;
	const wanted = Math.max(0, Math.min(requested, entries.length));
	return entries.slice(entries.length - wanted).reverse();
}

export function actionLogSize(): number {
	return entries.length;
}

export function clearActionLog(): void {
	entries.length = 0;
}

// What happened, as counts, for the support report.
//
// Deliberately not the entries themselves. A reddit fullname is globally
// resolvable -- one public `api/info?id=t3_x` call turns a pasted report into
// the list of posts the reader had on screen -- and a rule id they wrote or a
// host they visited is the same kind of tell. The report already reduces every
// stored option that could carry something private to a count, and this is that
// rule applied to the log. The panel in the settings shows the full rows, and
// stays in the reader's browser.
export function summariseActionLog(rows: $ReadOnlyArray<ActionEntry>): string[] {
	const counts: Map<string, number> = new Map();
	const reasons: Map<string, Set<string>> = new Map();

	for (const row of rows) {
		const key = `${row.moduleID}: ${row.outcome}`;
		counts.set(key, (counts.get(key) || 0) + 1);
		if (!row.reason) continue;
		const seen = reasons.get(row.moduleID) || new Set();
		seen.add(row.reason);
		reasons.set(row.moduleID, seen);
	}

	return [...counts.entries()]
		.sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey))
		.map(([key, count]) => {
			const moduleID = key.slice(0, key.indexOf(':'));
			const distinct = (reasons.get(moduleID) || new Set()).size;
			const times = `${count} time${count === 1 ? '' : 's'}`;
			if (!distinct) return `${key} ${times}`;
			return `${key} ${times} across ${distinct} rule${distinct === 1 ? '' : 's'} or host${distinct === 1 ? '' : 's'}`;
		});
}
