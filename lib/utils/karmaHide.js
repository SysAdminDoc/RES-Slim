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

// --- current Reddit ---------------------------------------------------------
//
// Every selector above is a light-DOM one, and current Reddit renders scores and
// comment counts inside each host's open shadow root, which document CSS cannot
// reach. So the same options produce a second sheet, installed per shadow root
// through `registerShadowStyle`.
//
// Both sides are generated from one `KarmaHideOptions` on purpose. The failure
// this avoids is the obvious one: two lists of selectors maintained separately,
// where turning an option off keeps hiding things on one renderer.
//
// The score is the element immediately after the upvote control. Reddit renders
// it as `<faceplate-number>`; the fixtures use a plain `<span>`, and older
// builds did too, so both are covered. Anchoring on the sibling relationship
// rather than on a class name is deliberate — the generated class names are not
// a contract, which is a rule this repo already learned the hard way.
const SHADOW_SCORE_SELECTORS = [
	'[data-action-bar-action=\'upvote\'] + faceplate-number',
	'[data-action-bar-action=\'upvote\'] + span',
];

// `:host()` is what keeps the post and comment options distinct. Inside a shadow
// root the markup is the same shape either way, so without it one option would
// silently hide both.
const forHost = (host: string) => SHADOW_SCORE_SELECTORS.map(selector => `:host(${host}) ${selector}`);

export const SHADOW_POST_SCORE_SELECTORS: string[] = forHost('shreddit-post');
export const SHADOW_COMMENT_SCORE_SELECTORS: string[] = forHost('shreddit-comment');
export const SHADOW_COMMENT_COUNT_SELECTORS: string[] = ['[data-action-bar-action=\'comments\']'];

// Hovering the number cannot work: `visibility: hidden` takes the element out of
// hit-testing, so it never receives the pointer. The upvote control next to it
// is the thing actually under the cursor, which matches how the document side
// reveals on `.midcol:hover` rather than on the score itself.
const SHADOW_HOVER_SELECTORS = SHADOW_SCORE_SELECTORS.map(selector => `[data-action-bar-action='upvote']:hover + ${selector.split('+ ')[1]}`);

export function karmaHideShadowRules(options: KarmaHideOptions): string {
	const out = [];
	const hide = (selectors: string[]) => out.push(`${selectors.join(', ')} { ${HIDDEN} }`);

	if (options.hidePostScores) hide(SHADOW_POST_SCORE_SELECTORS);
	if (options.hideCommentScores) hide(SHADOW_COMMENT_SCORE_SELECTORS);
	if (options.hideCommentCounts) hide(SHADOW_COMMENT_COUNT_SELECTORS);
	// `hideUserKarma` has no shadow-root equivalent. The header and profile
	// counters are light DOM on current Reddit, so the document sheet covers them
	// and there is nothing to add here.

	if (out.length && options.revealOnHover) {
		out.push(`${SHADOW_HOVER_SELECTORS.join(', ')} { visibility: visible !important; }`);
	}

	return out.join('\n');
}
