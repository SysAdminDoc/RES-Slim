/* @flow */

// CSS generation for the score/karma demetricator, separated from the module so
// a test can execute it. What matters here is not that a rule exists but that
// the reveal-on-hover rule is scoped to exactly the elements the hide rules
// cover — an unscoped `:hover .score` reveals scores the user asked to keep
// hidden the moment the pointer crosses any ancestor.

export type KarmaHideOptions = {|
	hidePostScores: boolean,
	hideCommentScores: boolean,
	hideUserKarma: boolean,
	hideCommentCounts: boolean,
	revealOnHover: boolean,
|};

// visibility rather than display: collapsing the element reflows the vote column
// and shifts every post on the page sideways as scores render.
const HIDDEN = 'visibility: hidden !important;';

export const POST_SCORE_SELECTORS = ['body.res .midcol .score', 'body.res .linkinfo .score'];
export const COMMENT_SCORE_SELECTORS = ['body.res .comment .tagline .score'];
export const USER_KARMA_SELECTORS = ['body.res #header .userkarma', 'body.res .titlebox .karma', 'body.res .side .karma'];
export const COMMENT_COUNT_SELECTORS = ['body.res .comments .number', 'body.res a.comments'];

const HOVER_SELECTORS = [
	'body.res .midcol:hover .score',
	'body.res .linkinfo:hover .score',
	'body.res .comment > .entry > .tagline:hover .score',
	'body.res #header .userkarma:hover',
	'body.res .titlebox:hover .karma',
];

export function karmaHideRules(options: KarmaHideOptions): string {
	const out = [];
	const hide = (selectors: string[]) => out.push(`${selectors.join(', ')} { ${HIDDEN} }`);

	if (options.hidePostScores) hide(POST_SCORE_SELECTORS);
	if (options.hideCommentScores) hide(COMMENT_SCORE_SELECTORS);
	if (options.hideUserKarma) hide(USER_KARMA_SELECTORS);
	if (options.hideCommentCounts) hide(COMMENT_COUNT_SELECTORS);

	// Nothing is hidden, so there is nothing to reveal; emitting the hover rule
	// anyway would make `visibility: visible !important` fight a subreddit
	// stylesheet that legitimately hid a score.
	if (out.length && options.revealOnHover) {
		out.push(`${HOVER_SELECTORS.join(', ')} { visibility: visible !important; }`);
	}

	return out.join('\n');
}
