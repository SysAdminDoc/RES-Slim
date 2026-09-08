// Reddit serves every profile-shaped route under `/u/` as well as `/user/`.
//
// The comment patterns in `lib/utils/location.js` already knew that. The
// profile, search and multireddit patterns did not, so `/u/bob` was not a
// profile page, `/u/bob/m/games` was not a multireddit, and a search inside one
// was not a search. Nothing announced any of it: a page type simply fell through
// to the default, and every module scoped to the real one sat the page out.
//
// The table below is deliberately paired: the same route under both prefixes
// has to give the same answer, because it is the same page.
//
// The regex-level cases live beside the module in `lib/utils/__tests__/`, which
// `tests/unit/utils-specs.test.mjs` runs through a shim for `ava`. What is here
// is what those cannot say: that both spellings agree, that the value a caller
// reads back is canonical, and that no page type is declared which no path can
// reach.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';
import { installDom } from './helpers/loadModule.mjs';

installDom({ url: 'https://www.reddit.com/', html: '<!doctype html><html><body></body></html>' });

const Location = await loadFlowModule('lib/utils/location.js', 'location-short-prefix');
const Current = await loadFlowModule('lib/utils/currentLocation.js', 'location-short-prefix-current', {
	deps: ['lib/utils/functional.js', 'lib/utils/location.js'],
});

// Both spellings of every profile-shaped route, and what each pattern owes it.
const PAIRS = [
	{ short: '/u/bob', long: '/user/bob', pattern: 'profile', captures: ['bob', undefined] },
	{ short: '/u/bob/', long: '/user/bob/', pattern: 'profile', captures: ['bob', undefined] },
	{ short: '/u/bob/posts', long: '/user/bob/posts', pattern: 'profile', captures: ['bob', 'posts'] },
	{ short: '/u/bob-x_1/saved', long: '/user/bob-x_1/saved', pattern: 'profile', captures: ['bob-x_1', 'saved'] },
	{ short: '/u/bob/m/games', long: '/user/bob/m/games', pattern: 'multireddit', captures: null },
	{ short: '/u/bob/f/feed', long: '/user/bob/f/feed', pattern: 'multireddit', captures: null },
	{ short: '/u/bob/m/games/search', long: '/user/bob/m/games/search', pattern: 'search', captures: [] },
	{ short: '/u/bob/comments/abc123/title/', long: '/user/bob/comments/abc123/title/', pattern: 'comments', captures: null },
];

test('the short prefix is the same page as the long one', () => {
	for (const { short, long, pattern } of PAIRS) {
		const regex = Location.regexes[pattern];
		assert.ok(regex.test(long), `${long} does not match ${pattern}, so the pair proves nothing`);
		assert.ok(regex.test(short), `${short} does not match ${pattern} while ${long} does`);
	}
});

test('the short prefix captures the same things the long one does', () => {
	for (const { short, long, pattern, captures } of PAIRS) {
		if (!captures) continue;
		const regex = Location.regexes[pattern];
		assert.deepEqual([...regex.exec(short)].slice(1), captures, short);
		assert.deepEqual([...regex.exec(long)].slice(1), captures, long);
	}
});

test('a multireddit reads back in one spelling, whichever was in the address bar', () => {
	// This value is parsed, not only compared: `filteReddit`'s CurrentMulti case
	// splits it on an optional `user/` prefix to get the owner. Handed the raw
	// short form it reads the owner as `u` and evaluates false, which is a filter
	// that silently stops applying.
	for (const path of ['/u/bob/m/games', '/user/bob/m/games', '/u/bob/m/games/new']) {
		history.pushState({}, '', path);
		Current.clearLocationCaches();
		assert.equal(Current.currentMultireddit(), 'user/bob/m/games', path);
	}

	// `me` has no prefix to canonicalise and must be left exactly as it is.
	history.pushState({}, '', '/me/m/games');
	Current.clearLocationCaches();
	assert.equal(Current.currentMultireddit(), 'me/m/games');
});

test('a profile answers under either spelling, and a multireddit is not one', () => {
	for (const path of ['/u/bob', '/user/bob', '/u/bob/posts']) {
		history.pushState({}, '', path);
		Current.clearLocationCaches();
		assert.equal(Current.currentUserProfile(), 'bob', path);
	}

	// The `(?!m\/)` guard has to survive the shorter prefix.
	for (const path of ['/u/bob/m/games', '/user/bob/m/games']) {
		history.pushState({}, '', path);
		Current.clearLocationCaches();
		assert.equal(Current.currentUserProfile(), undefined, path);
	}
});

test('no page type is declared that no path can reach', () => {
	// `profileCommentsPage` was declared, mapped to a regex, and unreachable:
	// it matched `/user/<name>/comments/<id>`, which is a post permalink, and
	// `comments` matches the same thing and is listed first in both renderers.
	// A page type nothing can answer is a scope no module can use, and a reader
	// of the list cannot tell it from a working one.
	const seen = new Set();
	for (const [app, spec] of Object.entries(Location.appPageTypes)) {
		for (const type of spec.pageTypes) {
			assert.ok(Location.regexes[type], `${app} declares '${type}', which has no pattern`);
			// The first declared type whose pattern matches is the answer, so a type
			// listed after one that subsumes it can never be reached.
			const example = EXAMPLES[type];
			// Not `continue`: a type with no example is a type this check silently
			// skips, which is how a check stops being one.
			assert.ok(example, `${app} declares '${type}' and EXAMPLES has no URL for it`);
			for (const earlier of seen) {
				assert.ok(
					!Location.regexes[earlier].test(example),
					`${app} can never answer '${type}': '${earlier}' matches ${example} first`,
				);
			}
			seen.add(type);
		}
		seen.clear();
	}
});

// One URL per page type that only that type should own, for the reachability
// check above. A type with no example here is not checked, which is why adding
// one is worth the line.
const EXAMPLES = {
	wiki: '/r/example/wiki/index',
	search: '/r/example/search',
	stylesheet: '/r/example/about/stylesheet',
	modqueue: '/r/example/about/modqueue',
	subredditAbout: '/r/example/about/rules',
	comments: '/r/example/comments/abc123/title/',
	commentsLinklist: '/user/bob/comments',
	profile: '/user/bob',
	liveThread: '/live/xyz789',
	inbox: '/message/inbox',
	submit: '/submit',
	account: '/account-activity',
	prefs: '/prefs',
};

test('one page has one key, whichever spelling was in the address bar', () => {
	// `fullLocation` is used as a key. Widening the patterns to accept `/u/`
	// without normalising here would have given one multireddit two keys, which is
	// the same reasoning `currentMultireddit` already applies one file over.
	const pairs = [
		['/u/bob', '/user/bob'],
		['/u/bob/m/games', '/user/bob/m/games'],
		['/u/bob/comments/abc123/title/', '/user/bob/comments/abc123/title/'],
		['/u/bob/m/games/search', '/user/bob/m/games/search'],
	];
	for (const [short, long] of pairs) {
		assert.equal(Location.fullLocation(short), Location.fullLocation(long), short);
	}

	// And it is still a key rather than the path back.
	assert.equal(Location.fullLocation('/user/bob/m/games'), 'multireddit-user/bob/m/games');
});
