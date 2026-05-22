/* @flow */
// Pure helpers for the scopedFilters module. Two filter kinds:
//   1) Per-sub muting — user X is muted only when browsing sub Y.
//   2) URL substring block — any post/comment whose URL contains a configured
//      fragment is hidden. Catches affiliate-spam patterns.
// Dependency-free for unit testing.

export type PerSubMute = {| user: string, sub: string |};

export function parsePerSubMutes(raw: mixed): PerSubMute[] {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	const out: PerSubMute[] = [];
	const seen: Set<string> = new Set();
	for (const piece of raw.split(/[,\n]+/)) {
		const trimmed = piece.trim();
		if (!trimmed) continue;
		// Accept "user|sub" or "user@sub" syntax. Either side may carry a u/ or r/ prefix.
		const m = /^([^|@]+)[|@](.+)$/.exec(trimmed);
		if (!m) continue;
		const user = m[1].trim().toLowerCase().replace(/^\/?u\//, '').replace(/^\/?user\//, '');
		const sub = m[2].trim().toLowerCase().replace(/^\/?r\//, '');
		if (!user || !sub) continue;
		const key = `${user}|${sub}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ user, sub });
	}
	return out;
}

export function muteApplies(
	mutes: $ReadOnlyArray<PerSubMute>,
	currentSub: string,
	authorName: string,
): boolean {
	const sub = (currentSub || '').toLowerCase();
	const author = (authorName || '').toLowerCase();
	if (!sub || !author) return false;
	for (const m of mutes) {
		if (m.user === author && (m.sub === '*' || m.sub === sub)) return true;
	}
	return false;
}

export function parseUrlSubstrings(raw: mixed): string[] {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	const out: string[] = [];
	const seen: Set<string> = new Set();
	for (const piece of raw.split(/[,\n]+/)) {
		const norm = piece.trim().toLowerCase();
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
}

export function urlMatchesAny(
	candidateUrls: $ReadOnlyArray<string>,
	substrings: $ReadOnlyArray<string>,
): boolean {
	if (!substrings.length) return false;
	for (const candidate of candidateUrls) {
		if (!candidate) continue;
		const lower = candidate.toLowerCase();
		for (const s of substrings) {
			if (lower.includes(s)) return true;
		}
	}
	return false;
}
