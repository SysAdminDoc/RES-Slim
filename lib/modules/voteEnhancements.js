/* @flow */

// Ported from upstream RES. Vote-count estimation is intentionally absent:
// upstream removed it in d78d68a90 because Reddit's rounded vote percentage
// cannot produce trustworthy upvote and downvote totals.

import { Module } from '../core/module';
import { addCSS, Thing, watchForThings } from '../utils';
import * as Modules from '../core/modules';
import {
	automaticCommentScoreColor,
	automaticLinkScoreColor,
	readableScoreInk,
	opaqueGround,
	readableScoreText,
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

// Every surface the score number can be painted on.
//
// Unlike the rank badge, the number has no ground of its own. Whatever is behind
// it decides whether it can be read, and that is not one thing: the palette
// paints `.thing` with `--rsm-th-bg-elev`, a hovered listing row with
// `--rsm-th-bg-raise`, and alternating comment depths with both. Correcting
// against the page background alone put roughly half the hue wheel back under
// the floor the moment the reader hovered a row -- measured across the palettes
// on 2026-09-08, the default Classic correction of `rgb(164, 106, 10)` is
// 4.15:1 on `--rsm-th-bg-raise`.
//
// With no palette running, the tokens are empty and the body's own background is
// the honest answer; white is the fallback, because that is what an unpainted
// old Reddit page is.
const PALETTE_SURFACE_TOKENS = ['--rsm-th-bg', '--rsm-th-bg-elev', '--rsm-th-bg-raise'];
const FALLBACK_GROUND: [number, number, number] = [255, 255, 255];
let cachedGrounds: ?Array<[number, number, number]> = null;
let groundWatcher: ?MutationObserver = null;

function readGrounds(): Array<[number, number, number]> {
	const root = document.documentElement;
	if (!root) return [FALLBACK_GROUND];
	const style = getComputedStyle(root);
	const painted = PALETTE_SURFACE_TOKENS
		.map(token => opaqueGround(style.getPropertyValue(token)))
		.filter(Boolean);
	if (painted.length) return (painted: any);
	const body = document.body && opaqueGround(getComputedStyle(document.body).backgroundColor);
	return [body || FALLBACK_GROUND];
}

// Cached, because this is a `getComputedStyle` and the watcher runs once per
// post. The cache is dropped when the root's classes change, which is how a
// palette and the night skin both arrive and leave, and on a route change --
// and dropping it is not enough on its own, because nothing re-runs for a post
// already on screen, so the scores are repainted with it.
function repaintScores() {
	cachedGrounds = null;
	if (!Modules.isRunning(module)) return;
	const link = (module.options.colorLinkScore: any).value !== 'none';
	const comment = (module.options.colorCommentScore: any).value !== 'none';
	if (!link && !comment) return;
	for (const thing of Thing.visibleThings()) {
		if (link && thing.isPost()) applyLinkScoreColor(thing);
		else if (comment && thing.isComment()) applyCommentScoreColor(thing);
	}
}

function pageGrounds(): Array<[number, number, number]> {
	if (!groundWatcher && document.documentElement) {
		groundWatcher = new MutationObserver(repaintScores);
		groundWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('reddit.urlChanged', repaintScores);
	}
	if (!cachedGrounds) cachedGrounds = readGrounds();
	return cachedGrounds;
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
	const text = readableScoreText(color, pageGrounds());
	for (const [scoreElement] of thing.getAllScoreElements()) scoreElement.style.setProperty('color', text, 'important');
	applyShadowScore(thing, text);
}

function applyCommentScoreColor(thing: Thing): void {
	const score = thing.getScore();
	if (typeof score !== 'number') return;
	const color = commentScoreColor(score);
	if (!color) return;
	thing.element.setAttribute('data-res-vote-enhancements-score', '');
	const text = readableScoreText(color, pageGrounds());
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
