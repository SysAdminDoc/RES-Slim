import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const colors = await loadFlowModule('lib/utils/voteEnhancements.js', 'vote-enhancements', {
	deps: ['lib/utils/cssColor.js'],
});
const mod = readRepoFile('lib/modules/voteEnhancements.js');
const theme = readRepoFile('lib/css/modules/_pageTheme.scss');

test('custom score thresholds clamp and interpolate across the full range', () => {
	const rows = [[0, '#000000'], [10, '#ffffff'], [50, '#ff0000']];
	assert.equal(colors.thresholdScoreColor(-5, rows, '#abcdef', true), '#000000');
	assert.equal(colors.thresholdScoreColor(5, rows, '#abcdef', true), 'rgb(128, 128, 128)');
	assert.equal(colors.thresholdScoreColor(30, rows, '#abcdef', true), 'rgb(255, 128, 128)');
	assert.equal(colors.thresholdScoreColor(500, rows, '#abcdef', true), '#ff0000');
});

test('stepped thresholds keep upstream negative-score behavior', () => {
	const rows = [[-10, '#000000'], [-5, '#333333'], [0, '#666666'], [10, '#ffffff']];
	assert.equal(colors.thresholdScoreColor(-8, rows, '#abcdef', false), '#333333');
	assert.equal(colors.thresholdScoreColor(8, rows, '#abcdef', false), '#666666');
});

test('invalid saved rows cannot produce an invalid inline colour', () => {
	assert.equal(colors.thresholdScoreColor(5, [], '#abcdef', true), '#abcdef');
	assert.equal(colors.thresholdScoreColor(5, [['oops', '#fff'], [10, 'not-a-colour']], '#abcdef', true), '#abcdef');
});

test('automatic post and comment scales retain the upstream formulas', () => {
	assert.equal(colors.automaticLinkScoreColor(50), 'hsl(360, 75%, 50%)');
	assert.equal(colors.automaticCommentScoreColor(0), 'hsl(360, 75%, 50%)');
	assert.notEqual(colors.automaticLinkScoreColor(10), colors.automaticLinkScoreColor(100));
});

test('the port is opt-in, registered by the repo contract, and reaches both renderers', () => {
	assert.match(mod, /module\.disabledByDefault = true/);
	assert.match(mod, /module\.include = \['r2', 'd2x'\]/);
	assert.match(mod, /watchForThings\(\['post'\], applyLinkScoreColor\)/);
	assert.match(mod, /watchForThings\(\['comment'\], applyCommentScoreColor\)/);
	assert.doesNotMatch(mod, /registerShadowStyle|shadowRoot\.querySelectorAll/);
	assert.match(theme, /shreddit-post\[data-res-vote-enhancements-score\]::part\(rsm-score\)/);
	assert.match(theme, /shreddit-comment\[data-res-vote-enhancements-score\]::part\(rsm-score\)/);
	assert.doesNotMatch(mod, /estimatePost(?:Score|Votes)|totalvotes|upvotes|downvotes/);
});
