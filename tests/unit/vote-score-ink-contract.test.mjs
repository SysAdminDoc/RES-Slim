// The rank badge's ink has to be chosen from the ground it lands on.
//
// `.link .rank` wrote `color: #fff` over a background `applyLinkScoreColor`
// paints from the score. The automatic mode walks the entire hue wheel at
// `hsl(H, 75%, 50%)`, so a post near 150 points had white digits on yellow:
// 1.43:1. No contrast contract could see it, because they all resolve colours
// out of a stylesheet and this one is written by JS at runtime.
//
// The e2e measures the real rendered badge. This measures the decision itself,
// across the whole wheel rather than the three scores a browser test can afford.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const { hslToRgb, contrastRatio } = await loadFlowModule('lib/utils/usernameColors.js', 'vote-score-ink-hsl');
const votes = await loadFlowModule('lib/utils/voteEnhancements.js', 'vote-score-ink', {
	deps: ['lib/utils/cssColor.js', 'lib/utils/usernameColors.js'],
});

const WCAG_AA = 4.5;

// The whole hue wheel, one degree at a time.
const WHEEL = Array.from({ length: 360 }, (_, hue) => hue);

function ratioOf(ground) {
	const ink = votes.readableScoreInk(ground);
	const inkRgb = ink === '#000' ? [0, 0, 0] : [255, 255, 255];
	const groundRgb = votes.scoreColorRgb(ground);
	assert.ok(groundRgb, `${ground} should be parseable`);
	return { ink, ratio: contrastRatio(inkRgb, groundRgb) };
}

test('every ground the automatic link mode can produce is readable', () => {
	// 60 degrees is the yellow that measured 1.43:1 under the old fixed white.
	const worst = WHEEL
		.map(hue => ({ ground: `hsl(${hue}, 75%, 50%)` }))
		.map(({ ground }) => ({ ground, ratio: ratioOf(ground).ratio }))
		.reduce((lowest, candidate) => (candidate.ratio < lowest.ratio ? candidate : lowest));
	assert.ok(worst.ratio >= WCAG_AA, `${worst.ground} is ${worst.ratio.toFixed(2)}:1, needs ${WCAG_AA}:1`);
});

test('the scores the module actually sees land on readable grounds', () => {
	// -150 and -100 are the singular ones: each formula divides by an offset score
	// that reaches zero there, and `hsl(-Infinity, 75%, 50%)` is not a colour, so
	// `setProperty` rejected it and the badge got no ground at all. `ratioOf`
	// insists the ground parses, so a return of that would fail here rather than
	// pass quietly.
	for (const score of [-500, -151, -150, -149, -100, -1, 0, 1, 10, 150, 600, 5000, 250000]) {
		const ground = votes.automaticLinkScoreColor(score);
		const { ink, ratio } = ratioOf(ground);
		assert.ok(ratio >= WCAG_AA, `score ${score} is ${ink} on ${ground}, ${ratio.toFixed(2)}:1`);
	}
	// The comment formula has the same shape and its own singularity.
	for (const score of [-101, -100, -99, 0, 100]) {
		const ground = votes.automaticCommentScoreColor(score);
		assert.ok(votes.scoreColorRgb(ground), `comment score ${score} produced ${ground}, which is not a colour`);
	}
});

test('the choice is genuinely a choice, not white everywhere', () => {
	// A helper that returned `#fff` unconditionally would pass the wheel test on
	// every dark hue and fail only where the old code did. Both inks have to be
	// reachable, or the two tests above are measuring a constant.
	const inks = new Set(WHEEL.map(hue => votes.readableScoreInk(`hsl(${hue}, 75%, 50%)`)));
	assert.deepEqual([...inks].sort(), ['#000', '#fff'], 'both inks must be reachable across the wheel');
});

test('the stored-colour grounds are read too, including the no-rows defaults', () => {
	// `user` mode grounds arrive as hex from the option table, and `rgb()` when
	// interpolation blends two rows. `#c6c6c6` is the no-rows default and the
	// second ground that measured badly under fixed white: 1.71:1.
	const cases = [
		['#c6c6c6', '#000'],
		['#5f99cf', '#000'],
		['#d92b2b', '#fff'],
		// Reddit's upvote orange is lighter than it looks: 6.12:1 under black
		// against 3.43:1 under white, so it takes black.
		['rgb(255, 69, 0)', '#000'],
		['#FFF', '#000'],
	];
	for (const [ground, expected] of cases) {
		const { ink, ratio } = ratioOf(ground);
		assert.equal(ink, expected, `${ground} should take ${expected}`);
		assert.ok(ratio >= WCAG_AA, `${ground} is ${ratio.toFixed(2)}:1`);
	}
});

test('a ground it cannot read keeps the ink the badge always had', () => {
	// Failing open to white is the old behaviour, not a new hazard: a rank whose
	// ground was never painted is exactly the case the CSS fallback covers.
	for (const unreadable of ['', '   ', 'rebeccapurple', 'var(--nope)', null, undefined, 42]) {
		assert.equal(votes.readableScoreInk(unreadable), '#fff');
		assert.equal(votes.scoreColorRgb(unreadable), null);
	}
});

test('the hsl arm agrees with the shared conversion, in both spellings', () => {
	// `hslRgb` re-parses rather than re-deriving. If it drifted from `hslToRgb`
	// the ink would be chosen from a colour the page never paints.
	for (const [h, s, l] of [[0, 75, 50], [60, 75, 50], [210, 40, 30], [359, 100, 99]]) {
		const expected = hslToRgb(h, s, l);
		assert.deepEqual(votes.scoreColorRgb(`hsl(${h}, ${s}%, ${l}%)`), expected, 'comma form');
		assert.deepEqual(votes.scoreColorRgb(`hsl(${h}deg ${s}% ${l}%)`), expected, 'space form');
		assert.deepEqual(votes.scoreColorRgb(`hsla(${h}, ${s}%, ${l}%, 0.5)`), expected, 'alpha is dropped');
	}
});

test('the stylesheet reads the token the module writes', () => {
	// Three links in one chain, and the CSS half is unreachable from Node.
	const scss = readRepoFile('lib/css/modules/_voteEnhancements.scss');
	assert.match(scss, /color: var\(--rsm-vote-enhancements-ink, #fff\);/, 'the badge has to read the token');
	assert.ok(!/color: #fff;/.test(scss), 'and nothing may go back to painting it fixed white');

	const module = readRepoFile('lib/modules/voteEnhancements.js');
	assert.match(module, /setProperty\('--rsm-vote-enhancements-ink', readableScoreInk\(color\)\)/,
		'the module has to write it from the same colour it paints as the ground');
});
