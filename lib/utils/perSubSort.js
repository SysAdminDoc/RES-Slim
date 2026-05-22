/* @flow */
// Pure helpers for the perSubSort module. Parses old.reddit subreddit URLs,
// classifies the current sort, and decides whether to redirect to a stored
// per-sub default. Dependency-free so it can be unit-tested without DOM.

export type SortRoute = {|
	sub: ?string,        // null on the front page
	sort: ?string,       // null when the URL did not include an explicit sort
	t: ?string,          // time-window for top/controversial
|};

export type SortPreference = {|
	sort: string,
	t?: string,
|};

export const SUPPORTED_SORTS: $ReadOnlyArray<string> = Object.freeze([
	'hot', 'new', 'rising', 'top', 'controversial', 'best',
]);

export const SUPPORTED_TIME_WINDOWS: $ReadOnlyArray<string> = Object.freeze([
	'hour', 'day', 'week', 'month', 'year', 'all',
]);

const SUB_PATH_RE = /^\/r\/([^/]+)(?:\/([a-z]+))?\/?$/i;

export function parseSubListingPath(pathname: string, search: string = ''): SortRoute {
	if (typeof pathname !== 'string') return { sub: null, sort: null, t: null };
	let path = pathname;
	if (!path.startsWith('/r/')) return { sub: null, sort: null, t: null };
	const m = SUB_PATH_RE.exec(path);
	if (!m) return { sub: null, sort: null, t: null };
	const sub = (m[1] || '').toLowerCase();
	const segment = (m[2] || '').toLowerCase();
	const sort = segment && SUPPORTED_SORTS.indexOf(segment) >= 0 ? segment : null;
	let t: ?string = null;
	if (search && typeof search === 'string') {
		const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
		const raw = params.get('t');
		if (raw && SUPPORTED_TIME_WINDOWS.indexOf(raw.toLowerCase()) >= 0) t = raw.toLowerCase();
	}
	return { sub, sort, t };
}

export function buildSortedPath(sub: string, pref: SortPreference): string {
	const s = (sub || '').toLowerCase();
	if (!s) return '/';
	const sort = (pref.sort || '').toLowerCase();
	if (SUPPORTED_SORTS.indexOf(sort) < 0) return `/r/${s}/`;
	let url = `/r/${s}/${sort}/`;
	const t = pref.t && SUPPORTED_TIME_WINDOWS.indexOf(pref.t.toLowerCase()) >= 0 ? pref.t.toLowerCase() : '';
	if ((sort === 'top' || sort === 'controversial') && t) {
		url += `?t=${t}`;
	}
	return url;
}

export function shouldRedirect(route: SortRoute, pref: ?SortPreference): boolean {
	if (!pref || !pref.sort) return false;
	if (!route.sub) return false;
	// Only redirect when the user hit the bare /r/<sub>/ URL.
	if (route.sort !== null) return false;
	return true;
}

export function normalizePreference(raw: mixed): SortPreference | null {
	if (!raw || typeof raw !== 'object') return null;
	const r: any = raw;
	const sort = typeof r.sort === 'string' ? r.sort.toLowerCase() : '';
	if (SUPPORTED_SORTS.indexOf(sort) < 0) return null;
	const t = typeof r.t === 'string' ? r.t.toLowerCase() : '';
	if (sort === 'top' || sort === 'controversial') {
		return SUPPORTED_TIME_WINDOWS.indexOf(t) >= 0 ? { sort, t } : { sort };
	}
	return { sort };
}
