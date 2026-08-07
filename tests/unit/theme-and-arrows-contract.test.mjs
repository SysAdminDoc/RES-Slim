import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

// Three small appearance modules whose behaviour is pure enough to execute:
// systemThemeSync's decision, karmaHide's CSS, and restoreVoteArrows' CSS.

const st = await loadFlowModule('lib/utils/systemTheme.js', 'system-theme');
const kh = await loadFlowModule('lib/utils/karmaHide.js', 'karma-hide');
const va = await loadFlowModule('lib/utils/voteArrows.js', 'vote-arrows');

// --- systemThemeSync ---------------------------------------------------------

test('following the system works in both directions', () => {
	assert.equal(st.decideNightMode(true, 'both', false), true);
	assert.equal(st.decideNightMode(false, 'both', true), false);
	assert.equal(st.decideNightMode(true, 'both', true), true);
	assert.equal(st.decideNightMode(false, 'both', false), false);
});

test('dark-only never turns night mode off', () => {
	// The reason the option exists: an OS that flips to light during the day
	// should not drag reddit with it.
	assert.equal(st.decideNightMode(true, 'darkOnly', false), true);
	assert.equal(st.decideNightMode(false, 'darkOnly', true), true);
	assert.equal(st.decideNightMode(false, 'darkOnly', false), false);
});

test('an unknown direction value falls back to following the system', () => {
	assert.equal(st.decideNightMode(true, 'nonsense', false), true);
	assert.equal(st.decideNightMode(false, '', true), false);
});

test('systemThemeSync moves the localStorage flag with the option', () => {
	// nightMode reads that flag at document_start to avoid a flash of the wrong
	// theme; writing only the option means the next page load flashes.
	const mod = readRepoFile('lib/modules/systemThemeSync.js');
	assert.match(mod, /localStorage\.setItem\(NIGHT_STORAGE_KEY/);
	assert.match(mod, /localStorage\.removeItem\(NIGHT_STORAGE_KEY/);
	assert.match(mod, /nightMode\.options\.nightModeOn\.value = on/);
	// addEventListener, not the deprecated addListener — the fork's floors have it.
	assert.match(mod, /mq\.addEventListener\('change'/);
	assert.match(mod, /module\.disabledByDefault = true/);
});

// --- karmaHide ---------------------------------------------------------------

const ALL_KARMA = {
	hidePostScores: true,
	hideCommentScores: true,
	hideUserKarma: true,
	hideCommentCounts: true,
	revealOnHover: true,
};

test('karmaHide emits nothing when every surface is off', () => {
	assert.equal(kh.karmaHideRules({ ...ALL_KARMA, hidePostScores: false, hideCommentScores: false, hideUserKarma: false, hideCommentCounts: false }), '');
});

test('karmaHide hides with visibility, never display', () => {
	// display: none collapses the vote column and shifts every post sideways as
	// scores render.
	const css = kh.karmaHideRules(ALL_KARMA);
	assert.match(css, /visibility: hidden !important;/);
	assert.doesNotMatch(css, /display:\s*none/);
});

test('each karmaHide surface is independently controllable', () => {
	const only = key => kh.karmaHideRules({
		hidePostScores: false,
		hideCommentScores: false,
		hideUserKarma: false,
		hideCommentCounts: false,
		revealOnHover: false,
		[key]: true,
	});
	assert.match(only('hidePostScores'), /\.midcol \.score/);
	assert.doesNotMatch(only('hidePostScores'), /\.comment \.tagline \.score/);
	assert.match(only('hideCommentScores'), /\.comment \.tagline \.score/);
	assert.match(only('hideUserKarma'), /#header \.userkarma/);
	assert.match(only('hideCommentCounts'), /a\.comments/);
	assert.doesNotMatch(only('hideCommentCounts'), /\.midcol \.score/);
});

test('the reveal-on-hover rule is scoped to the elements that were hidden', () => {
	// An unscoped `:hover .score` reveals scores the moment the pointer crosses
	// any ancestor, which defeats the module while looking like it works.
	const css = kh.karmaHideRules(ALL_KARMA);
	const hover = css.split('\n').find(line => line.includes('visibility: visible'));
	assert.ok(hover, 'expected a reveal rule');
	assert.doesNotMatch(hover, /body\.res:hover/);
	assert.doesNotMatch(hover, /\.thing:hover/);
	assert.match(hover, /\.midcol:hover \.score/);
	assert.match(hover, /\.tagline:hover \.score/);
});

test('no reveal rule is emitted when nothing is hidden', () => {
	const css = kh.karmaHideRules({
		hidePostScores: false,
		hideCommentScores: false,
		hideUserKarma: false,
		hideCommentCounts: false,
		revealOnHover: true,
	});
	assert.equal(css, '');
});

// --- restoreVoteArrows -------------------------------------------------------

test('restoring an arrow cancels all four ways a subreddit can hide it', () => {
	// display, visibility, zero dimensions, and off-screen positioning. Cancelling
	// only `display` — what the userscripts do — fails on about half the
	// subreddits the feature is aimed at.
	const css = va.voteArrowRules({ restoreUpvote: true, restoreDownvote: true, restoreDefaultSprite: false });
	assert.match(css, /display: block !important;/);
	assert.match(css, /visibility: visible !important;/);
	assert.match(css, /width: 15px !important;/);
	assert.match(css, /height: 15px !important;/);
	assert.match(css, /position: static !important;/);
});

test('the vote column itself is restored, not just the arrows inside it', () => {
	const css = va.voteArrowRules({ restoreUpvote: false, restoreDownvote: true, restoreDefaultSprite: false });
	assert.match(css, /\.midcol \{/);
});

test('each arrow direction is independently controllable', () => {
	const down = va.voteArrowRules({ restoreUpvote: false, restoreDownvote: true, restoreDefaultSprite: false });
	assert.match(down, /\.arrow\.down/);
	assert.doesNotMatch(down, /\.arrow\.up,/);

	const up = va.voteArrowRules({ restoreUpvote: true, restoreDownvote: false, restoreDefaultSprite: false });
	assert.match(up, /\.arrow\.up,/);
	assert.doesNotMatch(up, /\.arrow\.down,/);
});

test('nothing is emitted when both directions are off', () => {
	assert.equal(va.voteArrowRules({ restoreUpvote: false, restoreDownvote: false, restoreDefaultSprite: true }), '');
});

test('the default sprite is opt-in and only ships alongside a restore', () => {
	const without = va.voteArrowRules({ restoreUpvote: true, restoreDownvote: true, restoreDefaultSprite: false });
	assert.doesNotMatch(without, /sprite-reddit/);

	const with_ = va.voteArrowRules({ restoreUpvote: true, restoreDownvote: true, restoreDefaultSprite: true });
	assert.match(with_, /redditstatic\.com\/sprite-reddit/);
	assert.match(with_, /\.arrow\.upmod \{ background-position/);
});
