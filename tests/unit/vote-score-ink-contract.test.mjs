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
import { loadModule, installDom } from './helpers/loadModule.mjs';

// A DOM, for the one test that needs a real `Thing` to read a score off.
installDom({ url: 'https://old.reddit.com/r/example/' });
const { Thing } = await loadModule('lib/utils/index.js', 'vote-score-ink-thing');

const { hslToRgb, rgbToHsl, contrastRatio } = await loadFlowModule('lib/utils/usernameColors.js', 'vote-score-ink-hsl');
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

test('a post whose score reddit is hiding is left uncoloured, not painted NaN', () => {
	// `Thing.getScore()` read `data-score` with `if (!isNaN(dataset.score))`, and
	// `isNaN('')` is false because `Number('')` is 0 -- so a post whose score
	// reddit withholds returned `parseInt('')`, which is NaN. Every caller guards
	// with `typeof score !== 'number'`, and NaN passes that, so the NaN reached
	// `automaticLinkScoreColor` and came out as `hsl(NaN, 75%, 50%)`. That is not
	// a colour: `setProperty` rejects it, and the badge is left with no ground
	// while the ink is chosen for a colour nothing painted.
	const post = score => {
		const element = document.createElement('div');
		element.className = 'thing link';
		element.setAttribute('data-fullname', 't3_scored1');
		if (score !== null) element.setAttribute('data-score', score);
		element.innerHTML = '<div class="entry"><p class="title"><a class="title" href="/r/x/comments/a/b/">t</a></p></div>';
		document.body.append(element);
		return Thing.checkedFrom(element);
	};

	// The case reddit actually emits, and the ones around it. What matters is the
	// shape a caller sees: `applyLinkScoreColor` returns early on
	// `typeof score !== 'number'`, and NaN slips through that guard while null
	// does not.
	for (const hidden of ['', '   ', 'none']) {
		const score = post(hidden).getScore();
		assert.equal(Number.isNaN(score), false, `data-score="${hidden}" read as NaN`);
		assert.notEqual(typeof score, 'number', `data-score="${hidden}" has to fail the caller's guard`);
	}
	assert.equal(post('42').getScore(), 42, 'and a real score still arrives');
	assert.equal(post('-150').getScore(), -150, 'including the one the hue formula divides by zero on');
	assert.equal(post('0').getScore(), 0, 'zero is a score, not an absence of one');

	// And the colour helpers still refuse to invent one for a NaN that reaches
	// them some other way.
	assert.equal(votes.scoreColorRgb(votes.automaticLinkScoreColor(NaN)), null,
		'an unparseable ground has to read as unparseable');
	assert.equal(votes.readableScoreInk(votes.automaticLinkScoreColor(NaN)), '#fff',
		'and fall back to the ink the badge always had');
});

test('the score number keeps its hue and moves only its lightness', () => {
	// The badge can take black or white ink because it has a ground of its own.
	// The number does not: it is painted on whatever the listing behind it is, so
	// the same yellow that is fine in a badge measures 1.43:1 on a white row. Black
	// or white is not the answer here, because the hue is the feature -- it is what
	// tells the reader roughly what the score is.
	const WHITE = [255, 255, 255];
	const NEAR_BLACK = [22, 22, 22];

	const worst = { ratio: Infinity, at: null };
	for (const hue of WHEEL) {
		const original = `hsl(${hue}, 75%, 50%)`;
		const corrected = votes.readableScoreText(original, WHITE);
		const rgb = votes.scoreColorRgb(corrected);
		assert.ok(rgb, `${original} corrected to something unreadable: ${corrected}`);

		const ratio = contrastRatio(rgb, WHITE);
		if (ratio < worst.ratio) { worst.ratio = ratio; worst.at = `${original} -> ${corrected}`; }

		// The hue is what carries the meaning, so it may not move. Compared with a
		// tolerance, because the round trip through whole-percent lightness and
		// integer channels cannot be exact.
		const [before] = rgbToHsl(votes.scoreColorRgb(original));
		const [after] = rgbToHsl(rgb);
		const drift = Math.abs(((before - after + 540) % 360) - 180);
		assert.ok(drift <= 2, `hue moved from ${before.toFixed(1)} to ${after.toFixed(1)} for ${original}`);
	}
	assert.ok(worst.ratio >= 4.5, `${worst.at} is ${worst.ratio.toFixed(2)}:1, needs 4.5:1`);

	// A colour that already clears the floor is returned untouched, rather than
	// nudged for no reason. Which hues those are is derived, not guessed: at 50%
	// lightness a red is dark enough to need correcting even on a near-black
	// page, and a yellow is not.
	let untouched = 0;
	for (const hue of WHEEL) {
		const original = `hsl(${hue}, 75%, 50%)`;
		const already = contrastRatio(votes.scoreColorRgb(original), NEAR_BLACK) >= 4.5;
		const corrected = votes.readableScoreText(original, NEAR_BLACK);
		if (already) {
			assert.equal(corrected, original, `${original} already reads at 4.5:1 and must not be moved`);
			untouched += 1;
		} else {
			assert.ok(contrastRatio(votes.scoreColorRgb(corrected), NEAR_BLACK) >= 4.5,
				`${original} was corrected to ${corrected}, which still cannot be read`);
		}
	}
	assert.ok(untouched > 0, 'no hue was left alone, so the early return is never taken');
	assert.ok(untouched < WHEEL.length, 'every hue was left alone, so the correction is never taken');

	// And the `user` mode's no-rows default, which is the second colour the item
	// named: 1.71:1 as text on a white row.
	const corrected = votes.readableScoreText('#c6c6c6', WHITE);
	assert.notEqual(corrected, '#c6c6c6', 'a grey that cannot be read has to move');
	assert.ok(contrastRatio(votes.scoreColorRgb(corrected), WHITE) >= 4.5);
});

test('a colour or a ground it cannot read is returned as it came', () => {
	// Refusing to colour at all would be a bigger change than the reader asked
	// for, so an unparseable input keeps the configured value.
	assert.equal(votes.readableScoreText('rebeccapurple', [255, 255, 255]), 'rebeccapurple');
	assert.equal(votes.readableScoreText('hsl(60, 75%, 50%)', null), 'hsl(60, 75%, 50%)');
	assert.equal(votes.readableScoreText(42, [255, 255, 255]), '');
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
