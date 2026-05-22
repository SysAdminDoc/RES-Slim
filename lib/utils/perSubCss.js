/* @flow */
// Pure helpers for the perSubCss module. Decides whether to strip subreddit
// stylesheets on the current page given a global mode and allow/deny lists.
// Dependency-free for unit testing.

export type SubCssMode = 'allow-all' | 'deny-all' | 'per-list';

export function parseSubList(raw: mixed): string[] {
	if (typeof raw !== 'string') return [];
	const out: string[] = [];
	const seen: Set<string> = new Set();
	for (const piece of raw.split(/[,\s\n]+/)) {
		const norm = piece.trim().toLowerCase().replace(/^\/?r\//, '');
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
}

export function normalizeMode(raw: mixed): SubCssMode {
	if (raw === 'allow-all' || raw === 'deny-all' || raw === 'per-list') return raw;
	return 'per-list';
}

export function currentSubFromPath(pathname: mixed): string {
	if (typeof pathname !== 'string') return '';
	const m = /^\/r\/([^/]+)/i.exec(pathname);
	return m ? m[1].toLowerCase() : '';
}

export function shouldStripStyles(
	currentSub: string,
	mode: SubCssMode,
	allowList: $ReadOnlyArray<string>,
	denyList: $ReadOnlyArray<string>,
): boolean {
	const sub = (currentSub || '').toLowerCase();
	if (mode === 'allow-all') {
		// Strip ONLY when the sub is explicitly denied.
		return !!sub && denyList.indexOf(sub) >= 0;
	}
	if (mode === 'deny-all') {
		// Strip EVERYWHERE except subs explicitly allowed.
		if (!sub) return true; // front page, /r/all, multireddits get stripped too
		return allowList.indexOf(sub) < 0;
	}
	// per-list — strip iff in deny, keep iff in allow, otherwise default keep.
	if (!sub) return false;
	if (denyList.indexOf(sub) >= 0) return true;
	if (allowList.indexOf(sub) >= 0) return false;
	return false;
}
