/* @flow */

// Ported from upstream RES. Vote-count estimation is intentionally absent:
// upstream removed it in d78d68a90 because Reddit's rounded vote percentage
// cannot produce trustworthy upvote and downvote totals.

import { Module } from '../core/module';
import { addCSS, Thing, watchForThings } from '../utils';
import {
	automaticCommentScoreColor,
	automaticLinkScoreColor,
	readableScoreInk,
	readableScoreText,
	scoreColorRgb,
	thresholdScoreColor,
} from '../utils/voteEnhancements';

import type { ScoreThreshold } from '../utils/voteEnhancements';
import type { ModuleOption } from '../core/module';

type RawOptions = { [string]: any };
type VoteEnhancementOptions = { [string]: ModuleOption<RawOptions> };

export const module: Module<RawOptions, VoteEnhancementOptions> = new Module('voteEnhancements');

module.moduleName = 'Vote enhancements';
module.category = 'appearanceCategory';
module.description = 'Color post and comment scores by vote weight, optionally interpolate custom color thresholds, and make controversial comments easier to spot. Works on old and current Reddit without guessing vote totals.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.disabledByDefault = true;
module.keywords = ['vote', 'score', 'rank', 'karma', 'colour', 'controversial'];

module.options = {
	highlightScores: {
		title: 'Bold score numbers',
		type: 'boolean',
		value: true,
		description: 'Make visible post and comment scores easier to scan.',
		bodyClass: true,
	},
	colorLinkScore: {
		title: 'Post score color',
		type: 'enum',
		values: [
			{ name: 'No coloration', value: 'none' },
			{ name: 'Automatic coloration', value: 'automatic' },
			{ name: 'User-defined coloration', value: 'user' },
		],
		value: 'none',
		description: 'Color listing ranks and post score numbers according to score.',
		bodyClass: true,
	},
	userDefinedLinkColoration: {
		title: 'Post score thresholds',
		dependsOn: options => options.colorLinkScore.value === 'user',
		type: 'table',
		addRowText: '+ add threshold',
		fields: [
			{ key: 'score', name: 'Score', type: 'text' },
			{ key: 'color', name: 'Color', type: 'color' },
		],
		value: [
			[0, '#5f99cf'],
			[10, '#f2b035'],
			[50, '#ff4500'],
			[100, '#d92b2b'],
		],
		description: 'Ascending score thresholds and their colors.',
		sort([a], [b]) {
			return Number(a) - Number(b) || String(a).localeCompare(String(b), undefined, { numeric: true });
		},
	},
	colorCommentScore: {
		title: 'Comment score color',
		type: 'enum',
		values: [
			{ name: 'No coloration', value: 'none' },
			{ name: 'Automatic coloration', value: 'automatic' },
			{ name: 'Reddit Classic', value: 'simple' },
			{ name: 'User-defined coloration', value: 'user' },
		],
		value: 'none',
		description: 'Color comment scores according to score.',
	},
	userDefinedCommentColoration: {
		title: 'Comment score thresholds',
		dependsOn: options => options.colorCommentScore.value === 'user',
		type: 'table',
		addRowText: '+ add threshold',
		fields: [
			{ key: 'score', name: 'Score', type: 'text' },
			{ key: 'color', name: 'Color', type: 'color' },
		],
		value: [
			[0, '#5f99cf'],
			[10, '#f2b035'],
			[50, '#ff4500'],
			[100, '#d92b2b'],
		],
		description: 'Ascending comment-score thresholds and their colors.',
		sort([a], [b]) {
			return Number(a) - Number(b) || String(a).localeCompare(String(b), undefined, { numeric: true });
		},
	},
	interpolateScoreColor: {
		title: 'Blend between thresholds',
		type: 'boolean',
		value: true,
		description: 'Blend smoothly between adjacent custom colors instead of stepping at each threshold.',
		advanced: true,
	},
	highlightControversial: {
		title: 'Highlight controversial comments',
		type: 'boolean',
		value: true,
		description: 'Use a distinct color for Reddit\'s controversial-comment marker.',
	},
	highlightControversialColor: {
		title: 'Controversial marker color',
		dependsOn: options => options.highlightControversial.value,
		advanced: true,
		type: 'color',
		value: '#cc0000',
		description: 'Color used for the controversial marker.',
	},
};

function interpolate(): boolean {
	return (module.options.interpolateScoreColor: any).value === true;
}

function linkScoreColor(score: number): string {
	if ((module.options.colorLinkScore: any).value === 'automatic') return automaticLinkScoreColor(score);
	return thresholdScoreColor(
		score,
		((module.options.userDefinedLinkColoration: any).value: ScoreThreshold[]),
		'#c6c6c6',
		interpolate(),
	);
}

function commentScoreColor(score: number): string | false {
	if ((module.options.colorCommentScore: any).value === 'automatic') return automaticCommentScoreColor(score);
	if ((module.options.colorCommentScore: any).value === 'simple') {
		return thresholdScoreColor(score, [[0, '#9494ff'], [1, '#888888'], [2, '#ff8b60']], '#888888', interpolate());
	}
	if ((module.options.colorCommentScore: any).value === 'user') {
		return thresholdScoreColor(
			score,
			((module.options.userDefinedCommentColoration: any).value: ScoreThreshold[]),
			'#888888',
			interpolate(),
		);
	}
	return false;
}

// The surface the score number is painted on.
//
// Unlike the rank badge, the number has no ground of its own. Whatever is behind
// it decides whether it can be read, and that is one of three things: the
// palette `pageTheme` painted, the legacy night skin, or reddit's own row. The
// first states itself in a custom property; for the other two the body's
// computed background is the honest answer, and white is the fallback because
// that is what an unpainted old Reddit page is.
//
// Cached, because this is a `getComputedStyle` and the watcher runs once per
// post: on a long infinite-scroll session that is one call per post otherwise.
// The cache is dropped when the root's classes change, which is how every one of
// those three arrives and leaves, and on a route change.
const FALLBACK_GROUND: [number, number, number] = [255, 255, 255];
let cachedGround: ?[number, number, number] = null;
let groundWatcher: ?MutationObserver = null;

function readGround(): [number, number, number] {
	const root = document.documentElement;
	if (!root) return FALLBACK_GROUND;
	const themed = getComputedStyle(root).getPropertyValue('--rsm-th-bg').trim();
	const fromTheme = themed && scoreColorRgb(themed);
	if (fromTheme) return fromTheme;
	const body = document.body && getComputedStyle(document.body).backgroundColor;
	const painted = body && scoreColorRgb(body);
	// `rgba(0, 0, 0, 0)` parses, and reads as black, which would call white text
	// readable on a page that is actually white. An unpainted body is the
	// fallback case, not a black one.
	if (painted && !/,\s*0\s*\)$/.test(String(body))) return painted;
	return FALLBACK_GROUND;
}

function pageGround(): [number, number, number] {
	if (!groundWatcher && document.documentElement) {
		groundWatcher = new MutationObserver(() => { cachedGround = null; });
		groundWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('reddit.urlChanged', () => { cachedGround = null; });
	}
	if (!cachedGround) cachedGround = readGround();
	return cachedGround;
}

function applyShadowScore(thing: Thing, color: string): void {
	if (!thing.element.matches('shreddit-post, shreddit-comment')) return;
	thing.element.setAttribute('data-res-vote-enhancements-score', '');
	thing.element.style.setProperty('--rsm-vote-enhancements-score', color);
}

function applyLinkScoreColor(thing: Thing): void {
	const score = thing.getScore();
	if (typeof score !== 'number') return;
	const color = linkScoreColor(score);
	thing.element.setAttribute('data-res-vote-enhancements-score', '');
	const rank = thing.getRankElement();
	if (rank) {
		rank.style.setProperty('background', color, 'important');
		// The badge's ink has to follow its ground, which is only known here.
		rank.style.setProperty('--rsm-vote-enhancements-ink', readableScoreInk(color));
	}
	// The number is not on the badge's ground, so it gets its own reading of the
	// same colour: hue and saturation kept, lightness moved only as far as it
	// takes to be legible on whatever is behind it.
	const text = readableScoreText(color, pageGround());
	for (const [scoreElement] of thing.getAllScoreElements()) scoreElement.style.setProperty('color', text, 'important');
	applyShadowScore(thing, text);
}

function applyCommentScoreColor(thing: Thing): void {
	const score = thing.getScore();
	if (typeof score !== 'number') return;
	const color = commentScoreColor(score);
	if (!color) return;
	thing.element.setAttribute('data-res-vote-enhancements-score', '');
	const text = readableScoreText(color, pageGround());
	for (const [scoreElement] of thing.getAllScoreElements()) scoreElement.style.setProperty('color', text, 'important');
	applyShadowScore(thing, text);
}

module.beforeLoad = () => {
	if ((module.options.colorLinkScore: any).value !== 'none') {
		watchForThings(['post'], applyLinkScoreColor);
	}
	if ((module.options.colorCommentScore: any).value !== 'none') {
		watchForThings(['comment'], applyCommentScoreColor);
	}

	if ((module.options.highlightControversial: any).value) {
		const color = (module.options.highlightControversialColor: any).value || '#cc0000';
		addCSS(`
			.comment.controversial > .entry .score::after {
				color: ${color};
			}
		`);
	}
};
