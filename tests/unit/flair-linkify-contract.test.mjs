import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const fs = await loadFlowModule('lib/utils/flairSearch.js', 'flair-search');
const mod = readRepoFile('lib/modules/flairLinkify.js');

function query(url) {
	return new URL(url, 'https://old.reddit.com').searchParams;
}

test('a flair label becomes a quoted flair_name search', () => {
	const url = fs.flairSearchUrl('askhistorians', 'Great Question!');
	assert.ok(url.startsWith('/r/askhistorians/search?'), url);
	assert.equal(query(url).get('q'), 'flair_name:"Great Question!"');
	assert.equal(query(url).get('restrict_sr'), 'on');
	assert.equal(query(url).get('t'), 'all', 'without t=all a flair unused this month returns nothing');
});

test('quotes inside the label are stripped, not escaped', () => {
	// reddit's query parser has no escape character, so a quote inside the label
	// silently truncates the query and the search returns the wrong posts.
	const url = fs.flairSearchUrl('movies', 'The "Best" Film');
	assert.equal(query(url).get('q'), 'flair_name:"The Best Film"');

	// Smart quotes hit the same parser, and the apostrophe form goes with them.
	assert.equal(fs.normalizeFlairLabel('It’s “fine”'), 'Its fine');
	assert.doesNotMatch(fs.normalizeFlairLabel('a “b” c'), /[“”"]/);
});

test('whitespace in a label is collapsed', () => {
	assert.equal(fs.normalizeFlairLabel('  Great    Question  '), 'Great Question');
});

test('an r/ prefix on the subreddit is accepted', () => {
	assert.ok(fs.flairSearchUrl('/r/aww', 'Cat').startsWith('/r/aww/search?'));
	assert.ok(fs.flairSearchUrl('r/aww', 'Cat').startsWith('/r/aww/search?'));
});

test('a missing subreddit or an empty label produces no link', () => {
	assert.equal(fs.flairSearchUrl('', 'Cat'), null);
	assert.equal(fs.flairSearchUrl(null, 'Cat'), null);
	assert.equal(fs.flairSearchUrl('aww', ''), null);
	assert.equal(fs.flairSearchUrl('aww', '   '), null);
	assert.equal(fs.flairSearchUrl('aww', '""'), null, 'a label that is nothing but quotes is empty once normalised');
});

test('user flair links to that author inside the subreddit', () => {
	// User flair is not indexed, so flair_name would return nothing; the useful
	// query is "everything this person posted here".
	const url = fs.userInSubredditSearchUrl('aww', 'SysAdminDoc');
	assert.equal(query(url).get('q'), 'author:SysAdminDoc');
	assert.equal(query(url).get('restrict_sr'), 'on');

	// A pasted profile link is a normal thing to find in flair markup.
	assert.equal(query(fs.userInSubredditSearchUrl('aww', '/u/someone')).get('q'), 'author:someone');
	assert.equal(query(fs.userInSubredditSearchUrl('aww', 'user/someone')).get('q'), 'author:someone');
});

test('deleted authors get no link', () => {
	assert.equal(fs.userInSubredditSearchUrl('aww', '[deleted]'), null);
	assert.equal(fs.userInSubredditSearchUrl('aww', ''), null);
});

test('the module wraps the flair element rather than replacing it', () => {
	// Subreddit stylesheets target the flair span itself; rebuilding it drops
	// their styling and the feature reads as "flair broke".
	assert.match(mod, /parent\.insertBefore\(anchor, element\)/);
	assert.match(mod, /anchor\.append\(element\)/);
	assert.match(mod, /rel = 'noopener noreferrer'/);
	assert.match(mod, /module\.disabledByDefault = true/);
});

test('the module prefers the row\'s own subreddit over the page\'s', () => {
	// On /r/all and multireddits the page subreddit is wrong for most rows, and a
	// flair search against the wrong subreddit returns nothing.
	assert.match(mod, /thing\.getSubreddit\(\) \|\| currentSubreddit\(\)/);
});
