/* @flow */

// Turn a flair label into the subreddit search that finds every post carrying it.
//
// reddit's own flair links only exist on the redesign; on old.reddit the flair
// is inert text. The search syntax it maps to is `flair_name:"<label>"`, which
// requires the label to be quoted and requires the quotes inside it to be
// stripped rather than escaped — reddit's query parser has no escape character,
// so a label containing a quote silently truncates the query.

export function normalizeFlairLabel(label: ?string): string {
	return String(label === null || label === undefined ? '' : label)
		.replace(/[“”‘’]/g, '') // smart quotes: same parser problem
		.replace(/"/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function flairSearchUrl(subreddit: ?string, label: ?string, sort: string = 'new'): ?string {
	const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
	const clean = normalizeFlairLabel(label);
	if (!sub || !clean) return null;

	const params = new URLSearchParams();
	params.set('q', `flair_name:"${clean}"`);
	params.set('restrict_sr', 'on');
	params.set('sort', sort);
	// Without this reddit applies its default relevance window and a flair that
	// has not been used this month returns nothing.
	params.set('t', 'all');

	return `/r/${sub}/search?${params.toString()}`;
}

// User flair has no search index of its own, so the useful link is "everything
// this person posted in this subreddit".
export function userInSubredditSearchUrl(subreddit: ?string, author: ?string): ?string {
	const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
	const user = String(author || '').replace(/^\/?u(?:ser)?\//i, '').trim();
	if (!sub || !user || user.startsWith('[')) return null;

	const params = new URLSearchParams();
	params.set('q', `author:${user}`);
	params.set('restrict_sr', 'on');
	params.set('sort', 'new');
	params.set('t', 'all');

	return `/r/${sub}/search?${params.toString()}`;
}
