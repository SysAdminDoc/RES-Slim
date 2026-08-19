/* @flow */

/* eslint-disable key-spacing */
export const regexes: { [string]: RegExp } = {
	frontpage:        /^\/(?:hot|new|rising|controversial|top)?(?:\/|$)/i,
	comments:         /^\/(?:r\/([\w\.]+)\/|(u(?:ser)?\/[\w-]+)\/)?comments\/([a-z0-9]+)(?:\/|$)/i,
	commentsLinklist: /^\/(r\/[\w\.\+]+\/|u(?:ser)?\/[\w-]+\/)?comments\/?$/i,
	inbox:            /^\/(?:r\/([\w\.]+)\/)?message(?:\/|$)/i,
	profile:          /^\/user\/([\w\-]+)(?:\/(?:(?!m\/)(\w+)))?\/?$/i,
	profileCommentsPage: /^\/user\/([\w\-]+)\/comments\/([a-z0-9]+)(?:\/|$)/i,
	submit:           /^\/(?:r\/([\w\.\+]+)\/)?submit(?:\/|$)/i,
	prefs:            /^\/prefs(?:\/|$)/i,
	account:          /^\/account-activity(?:\/|$)/i,
	wiki:             /^\/(?:r\/([\w\.]+)\/)?wiki(?:\/|$)/i,
	stylesheet:       /^\/(?:r\/([\w\.]+)\/)about\/stylesheet(?:\/|$)/i,
	search:           /^\/(?:r\/[\w\.\+]+\/|(?:me|user\/[\w\-]+)\/[mf]\/[\w\.\+]+\/|domain\/[^\/]+\/)?search(?:\/|$)/i,
	commentPermalink: /^\/(?:r\/([\w\.]+)\/)?comments\/([a-z0-9]+)\/[^\/]*\/([a-z0-9]+)(?:\/|$)/i,
	duplicates:       /^\/r\/[\w\.\+]+\/duplicates\/([a-z0-9]+)/i,
	subreddit:        /^\/r\/([\w\.\+]+)(?:\/|$)/i,
	subredditAbout:   /^\/r\/([\w\.]+)\/about(?:\/(?!modqueue|reports|spam|unmoderated|edited)|$)/i,
	modqueue:         /^\/(?:r|me\/f)\/([\w\.\+]+)\/about\/(?:modqueue|reports|spam|unmoderated|edited)(?:\/|$)/i,
	multireddit:      /^\/((?:me|user\/[\w\-]+)\/[mf]\/[\w\.\+]+)(?:\/|$)/i,
	domain:           /^\/domain\/([\w\.]+)(?:\/|$)/i,
	composeMessage:   /^\/(?:r\/([\w\.\+]+)\/)?message\/compose(?:\/|$)/i,
	liveThread:       /^\/live\/(?!create(?:\/|$))([a-z0-9]+)(?:\/|$)/i,
};
/* eslint-enable key-spacing */

export const execRegexes: { [string]: (path: string) => ?string[] } = {
	comments: path => {
		const match = regexes.comments.exec(path);
		if (!match) return match;
		match.splice(1, 2, match[1] || match[2] && match[2].replace(/^u.*\//, 'u_'));
		return match;
	},
};

export type PageType = 'wiki' | 'search' | 'profile' | 'profileCommentsPage' | 'stylesheet' | 'modqueue' | 'subredditAbout' | 'comments' | 'commentsLinklist' | 'liveThread' | 'inbox' | 'submit' | 'account' | 'prefs' | 'linklist';
export type AppType = 'r2' | 'd2x' | 'options';

export const appPageTypes: { [AppType]: {| default?: PageType, pageTypes: PageType[] |} } = {
	r2: {
		default: 'linklist',
		pageTypes: ['wiki', 'search', 'stylesheet', 'modqueue', 'subredditAbout', 'comments', 'commentsLinklist', 'profile', 'liveThread', 'inbox', 'submit', 'account', 'prefs'],
	},
	d2x: {
		default: 'linklist',
		pageTypes: ['wiki', 'search', 'modqueue', 'subredditAbout', 'comments', 'commentsLinklist', 'profile', 'profileCommentsPage', 'inbox', 'submit'],
	},
	options: {
		pageTypes: [],
	},
};

// Current Reddit publishes its own name for the page. `shreddit-app` carries
// `routename` and `pagetype`, reddit maintains both, and both survive SPA
// navigation — where the table above can only infer from the path, and infers
// wrong for any route it has no pattern for. Reddit's `/r/<sub>/s/<id>` share
// links are the live example: they are post pages, they match nothing here, so
// they come out as `linklist` and every comments-scoped module sits them out.
//
// Deliberately partial. Only values confirmed against captured markup are
// mapped; anything else falls through to the regexes, which is exactly the
// behaviour without this table, so an unrecognised route costs nothing. Add a
// value when it has been observed, not when it has been guessed.
export const d2xPageTypeAttributes: { [string]: PageType } = {
	post_detail: 'comments',
	search_results: 'search',
	popular: 'linklist',
};

export const d2xRouteNames: { [string]: PageType } = {
	post_page: 'comments',
	subreddit: 'linklist',
	profile_overview: 'profile',
	search_results: 'search',
};

export const fullLocation = (pathname: string = location.pathname) => {
	const regex = Object.keys(regexes).find(key => pathname.match(regexes[key]));
	if (!regex) return pathname.toLowerCase();

	// examples: domain-youtube.com, user-gueor, subreddit-enhancement+resissues
	return [
		regex,
		...(pathname.match(regexes[regex]) || []).slice(1), // ignore matched string
	]
		.filter(v => v)
		.join('-')
		.toLowerCase();
};

// A link is a comment code if all these conditions are true:
// * It has no content (i.e. content.length === 0)
// * Its href is of the form "/code" or "#code"
//
// In case it's not clear, here is a list of some common comment
// codes on a specific subreddit:
// https://www.reddit.com/r/metarage/comments/p3eqe/full_updated_list_of_comment_faces_wcodes/
// also for CSS hacks to do special formatting, like /r/CSSlibrary

const COMMENT_CODE_REGEX = /^[\/#].+$/;

export function isCommentCode(link: HTMLAnchorElement): boolean {
	// don't add annotations for hidden links - these are used as CSS
	// hacks on subreddits to do special formatting, etc.

	// Note that link.href will return the full href (which includes the
	// reddit.com domain). We don't want that.
	const href = link.getAttribute('href');

	const emptyText = link.textContent.length === 0;
	const isCommentCode = COMMENT_CODE_REGEX.test(href);

	return emptyText && isCommentCode;
}

export function isEmptyLink(link: HTMLAnchorElement): boolean {
	// Note that link.href will return the full href (which includes the
	// reddit.com domain). We don't want that.
	const href = link.getAttribute('href');
	return typeof href !== 'string' || href.startsWith('javascript:') || href === '#'; // eslint-disable-line no-script-url
}
