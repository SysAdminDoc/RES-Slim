import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from './helpers/loadFlowModule.mjs';

// Three modules that are DOM-only: autoLoadMoreComments, nsfwThumbnails and
// randomSubreddit. There is no pure core to execute, so these pin the specific
// decisions that make each one safe — every assertion below corresponds to a
// failure mode observed in the userscript each was rewritten from.

const autoLoad = readRepoFile('lib/modules/autoLoadMoreComments.js');
const nsfw = readRepoFile('lib/modules/nsfwThumbnails.js');
const random = readRepoFile('lib/modules/randomSubreddit.js');

// Each header explains what the original userscript did, naming the endpoints
// and services it used. Those names are prose, not calls, so the "never contacts
// X" checks below have to run against code with comments stripped.
function codeOnly(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		// Split on \r?\n and strip with an explicit character class rather than
		// `.*$`: on a CRLF checkout the trailing \r is not a line terminator to
		// `.`, so `$` never matches and every line comment survives the strip.
		.split(/\r?\n/)
		.map(line => line.replace(/(^|\s)\/\/[^\r\n]*/, '$1'))
		.join('\n');
}

const nsfwCode = codeOnly(nsfw);
const randomCode = codeOnly(random);

test('the comment stripper actually strips', () => {
	// Without this the two "never contacts X" tests below would pass for the
	// wrong reason the moment the stripper regressed.
	assert.match(nsfw, /frictionRemovers owns the \/over18 interstitial/);
	assert.doesNotMatch(nsfwCode, /frictionRemovers owns/);
	assert.match(random, /redditrand\.com/);
	assert.doesNotMatch(randomCode, /redditrand/);
});

test('autoLoadMoreComments is capped, throttled, and gives up when reddit refuses', () => {
	// The scripts this replaces loop on a bare setInterval with no ceiling, which
	// fires hundreds of morechildren requests at once and gets the account
	// throttled — the top complaint in their feedback threads.
	assert.match(autoLoad, /createRateLimiter\(/);
	assert.match(autoLoad, /limiter\.schedule\(/);
	assert.match(autoLoad, /maxClicks/);
	assert.match(autoLoad, /while \(clicked < max && barren < 2\)/);
	assert.doesNotMatch(autoLoad, /setInterval\(/);
	assert.match(autoLoad, /module\.disabledByDefault = true/);
});

test('autoLoadMoreComments never clicks the same stub twice', () => {
	assert.match(autoLoad, /const CLICKED_ATTR = 'data-rsm-autoloaded'/);
	assert.match(autoLoad, /a\.hasAttribute\(CLICKED_ATTR\)/);
	assert.match(autoLoad, /anchor\.setAttribute\(CLICKED_ATTR, '1'\)/);
});

test('autoLoadMoreComments measures progress by comments, not by stubs', () => {
	// A stub that is still present after a click is what a rate-limit response
	// looks like from the DOM. Counting clicks alone cannot tell the two apart.
	assert.match(autoLoad, /querySelectorAll\('\.comment'\)\.length/);
});

test('nsfwThumbnails uses the preview reddit already sent', () => {
	// The point of doing this on old.reddit rather than the redesign: the real
	// preview URL is already in the markup, so nothing has to be fetched.
	assert.match(nsfw, /getAttribute\('data-url'\)/);
	assert.doesNotMatch(nsfwCode, /\bfetch\(|\bajax\(/);
	assert.match(nsfw, /module\.disabledByDefault = true/);
});

test('nsfwThumbnails leaves spoilers alone by default', () => {
	// A spoiler tag is a deliberate choice by the poster; the NSFW placeholder is
	// applied to whole subreddits at a time.
	assert.match(nsfw, /showNsfw: \{[\s\S]{0,140}value: true/);
	assert.match(nsfw, /showSpoilers: \{[\s\S]{0,180}value: false/);
});

test('nsfwThumbnails marks what it restored', () => {
	// So a restored NSFW thumbnail is not mistaken for an ordinary one on a
	// shared screen.
	assert.match(nsfw, /markRestored: \{[\s\S]{0,160}value: true/);
	assert.match(nsfw, /outline = '2px solid/);
});

test('nsfwThumbnails does not claim to bypass an age gate', () => {
	// It clears a placeholder on content reddit already delivered. frictionRemovers
	// owns the /over18 interstitial; overlapping claims mislead about what is on.
	assert.doesNotMatch(nsfwCode, /over18\?dest|\/over18/);
	assert.match(nsfw, /does not touch the account-level/);
});

test('randomSubreddit contacts no third-party service', () => {
	// The comparable userscript routes the pick through redditrand.com, sending
	// the user's browsing to someone else's host for something reddit still
	// serves itself.
	assert.doesNotMatch(randomCode, /redditrand|\bfetch\(|\bajax\(/);
	assert.match(random, /'\/r\/randnsfw' : '\/r\/random'/);
	assert.match(random, /module\.disabledByDefault = true/);
});

test('randomSubreddit\'s new-tab option cannot be reached through window.opener', () => {
	assert.match(random, /rel = 'noopener noreferrer'/);
});

test('the pool enum has no duplicate values', () => {
	// Two entries sharing a value make one of them unselectable and the setting
	// silently unreachable.
	const block = random.match(/values: \[([\s\S]*?)\]/)[1];
	const values = [...block.matchAll(/value: '([^']+)'/g)].map(m => m[1]);
	assert.equal(new Set(values).size, values.length, `duplicate enum values: ${values.join(', ')}`);
});
