// A `list` option is one comma-separated string, and a space after a comma
// silently dropped the entry after it.
//
// `commentDepth` split the stored cell on commas and compared the pieces
// directly, so `askreddit, pics` applied to askreddit only: the second entry was
// " pics", with a leading space, and matched no subreddit. A trailing comma
// produced an empty entry. Nothing on screen said what the format was, and the
// `listType` these options have carried since they were introduced was read by
// nothing.
//
// This runs the module's real mousedown handler against a real anchor, because
// the defect is in what the handler compares, and a test that compared the same
// two strings itself would have agreed with the bug.

import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOnly, loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://old.reddit.com/', html: '<!doctype html><html><body></body></html>' });

// `../utils` is stubbed, but the two regexes that decide which subreddit a link
// is for are the real ones: `location.js` has no imports of its own, so it is
// loaded rather than copied. A copy would drift, and the subreddit this test
// turns on comes out of that pattern.
const commentDepth = await loadFlowModule('lib/modules/commentDepth.js', 'list-option-comment-depth', {
	deps: ['lib/utils/location.js', 'lib/utils/subredditBlacklist.js'],
	stubs: {
		'../core/module': [
			'export class Module {',
			'	constructor(id) { this.moduleID = id; this.options = {}; }',
			'}',
		].join('\n'),
		'../utils': [
			'export { regexes, execRegexes } from \'./location.mjs\';',
			'export const Thing = { from: () => null };',
		].join('\n'),
		'../utils/subredditBlacklist': 'export { parseSubredditList } from \'./subredditBlacklist.mjs\';\n',
	},
});

const { module: mod } = commentDepth;
const { parseSubredditList } = await loadFlowModule('lib/utils/subredditBlacklist.js', 'list-option-parser');

function setUp(rows, { defaultDepth = '4' } = {}) {
	mod.options = {
		defaultCommentDepth: { value: defaultDepth },
		defaultMinimumComments: { value: '0' },
		commentPermalinks: { value: true },
		commentPermalinksContext: { value: true },
		subredditCommentDepths: { value: rows },
	};
}

// The handler is installed once, on `document.body`, by `contentStart`.
let started = false;
function depthFor(href) {
	if (!started) { commentDepth.module.contentStart(); started = true; }

	document.body.replaceChildren();
	const link = document.createElement('a');
	link.href = href;
	link.textContent = 'a post';
	document.body.appendChild(link);

	link.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
	return new URL(link.href, 'https://old.reddit.com/').searchParams.get('depth');
}

test('a space after a comma no longer drops the entry after it', () => {
	// The acceptance criterion, exactly: `askreddit, pics` has to match pics.
	setUp([['askreddit, pics', '9', '0']]);

	assert.equal(depthFor('https://old.reddit.com/r/pics/comments/abc123/title/'), '9');
	// And the entry that always worked still does, so the fix is not a swap.
	assert.equal(depthFor('https://old.reddit.com/r/askreddit/comments/abc123/title/'), '9');
	// A subreddit nobody listed falls through to the default.
	assert.equal(depthFor('https://old.reddit.com/r/videos/comments/abc123/title/'), '4');
});

test('the shapes a pasted list arrives in are all the same subreddit', () => {
	for (const stored of ['pics', ' pics ', 'r/pics', '/r/pics', 'R/Pics', 'https://www.reddit.com/r/pics/', 'PICS']) {
		setUp([[stored, '7', '0']]);
		assert.equal(
			depthFor('https://old.reddit.com/r/pics/comments/abc123/title/'),
			'7',
			`a cell holding "${stored}" did not match r/pics`,
		);
	}
});

test('an empty entry matches nothing rather than everything', () => {
	// A trailing comma is the ordinary way to produce one, and an entry that
	// matches every subreddit would silently apply one row to the whole site.
	for (const stored of ['askreddit,', 'askreddit, ', ',askreddit', 'askreddit,,pics']) {
		setUp([[stored, '9', '0']]);
		assert.equal(
			depthFor('https://old.reddit.com/r/videos/comments/abc123/title/'),
			'4',
			`a cell holding "${stored}" matched an unlisted subreddit`,
		);
	}

	// The entries either side of the empty one still work.
	setUp([['askreddit,,pics', '9', '0']]);
	assert.equal(depthFor('https://old.reddit.com/r/pics/comments/abc123/title/'), '9');
});

test('rows are still taken in order, and a link that is not a post is left alone', () => {
	setUp([['pics', '3', '0'], ['pics, videos', '9', '0']]);
	assert.equal(depthFor('https://old.reddit.com/r/pics/comments/abc123/title/'), '3', 'the second row won');
	assert.equal(depthFor('https://old.reddit.com/r/videos/comments/abc123/title/'), '9');

	// Not a comments page, so nothing is rewritten at all.
	setUp([['pics', '9', '0']]);
	assert.equal(depthFor('https://old.reddit.com/r/pics/'), null);
	// And a depth the reader already asked for is left where it is.
	assert.equal(depthFor('https://old.reddit.com/r/pics/comments/abc123/title/?depth=2'), '2');
});

test('the console shows the format, and reads listType to decide which', () => {
	// `listType` was metadata nothing looked at. It is what picks the example now,
	// so a second list type gets its own rather than borrowing this one.
	const source = codeOnly(readRepoFile('lib/options/settingsConsole.js'));
	assert.match(source, /const LIST_PLACEHOLDER_KEYS = \{ subreddits: 'settingsConsoleListSubredditsPlaceholder' \};/);
	assert.match(source, /const placeholderKey = LIST_PLACEHOLDER_KEYS\[optionObject\.listType\];/);
	assert.match(source, /if \(placeholderKey\) thisOptionFormEle\.setAttribute\('placeholder', i18n\(placeholderKey\)\);/);

	const locale = JSON.parse(readRepoFile('locales/locales/en.json'));
	const message = locale.settingsConsoleListSubredditsPlaceholder.message;
	// An example, not a description of one. It has to be readable as a value the
	// field would accept, so the comma and the space are the point.
	assert.match(message, /^[a-z0-9_]+, [a-z0-9_]+$/);
	// And the example has to be a list this code actually accepts, or the hint on
	// screen teaches a format the reader's entries will be dropped for.
	assert.deepEqual(parseSubredditList(message).valid, ['askreddit', 'pics']);
	assert.deepEqual(parseSubredditList(message).invalid, []);
});
