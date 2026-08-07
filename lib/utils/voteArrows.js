/* @flow */

// CSS generation for forcing hidden vote arrows back into view.
//
// Subreddit stylesheets hide arrows in four different ways — `display: none`,
// `visibility: hidden`, zero width/height, and moving them off-screen with
// `position: absolute` plus a large offset. Overriding only `display`, which is
// what the userscripts in this space do, leaves the other three working, so the
// fix appears to fail on roughly half the subreddits it is aimed at. Each
// property below cancels one of those techniques; the test asserts all four are
// present, because dropping one is a silent partial fix.

export type VoteArrowOptions = {|
	restoreUpvote: boolean,
	restoreDownvote: boolean,
	restoreDefaultSprite: boolean,
|};

const UNHIDE_PROPERTIES = [
	'display: block !important;',
	'visibility: visible !important;',
	'opacity: 1 !important;',
	'width: 15px !important;',
	'height: 15px !important;',
	'margin: 2px auto 0 !important;',
	'position: static !important;',
	'text-indent: 0 !important;',
	'overflow: visible !important;',
];

// Unhiding the arrows inside a column the subreddit collapsed achieves nothing,
// so the column has to come back first.
const MIDCOL = 'body.res .midcol { display: block !important; visibility: visible !important; width: auto !important; }';

const DEFAULT_SPRITE = `body.res .arrow {
	background-image: url('//www.redditstatic.com/sprite-reddit.G4Uzfsr6nJc.png') !important;
	background-repeat: no-repeat !important;
	background-color: transparent !important;
	border: 0 !important;
}
body.res .arrow.up { background-position: 0 -140px !important; }
body.res .arrow.down { background-position: 0 -280px !important; }
body.res .arrow.upmod { background-position: 0 -167px !important; }
body.res .arrow.downmod { background-position: 0 -307px !important; }`;

function unhide(selector: string): string {
	return `${selector} {\n\t${UNHIDE_PROPERTIES.join('\n\t')}\n}`;
}

export function voteArrowRules(options: VoteArrowOptions): string {
	const out = [];
	if (options.restoreUpvote) out.push(unhide('body.res .arrow.up, body.res .arrow.upmod'));
	if (options.restoreDownvote) out.push(unhide('body.res .arrow.down, body.res .arrow.downmod'));
	if (out.length) out.unshift(MIDCOL);
	if (options.restoreDefaultSprite && out.length) out.push(DEFAULT_SPRITE);
	return out.join('\n');
}
