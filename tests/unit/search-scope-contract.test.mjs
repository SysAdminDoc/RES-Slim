import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlowModule, readRepoFile } from './helpers/loadFlowModule.mjs';

const ss = await loadFlowModule('lib/utils/searchScope.js', 'search-scope');
const mod = readRepoFile('lib/modules/searchScope.js');

const ALL = { restrictToSubreddit: true, includeOver18: true, legacySearch: true };
const NONE = { restrictToSubreddit: false, includeOver18: false, legacySearch: false };

function params(url) {
	return new URL(url, 'https://old.reddit.com').searchParams;
}

test('restrict_sr is applied to a subreddit search', () => {
	const out = ss.applySearchScope('/r/askhistorians/search?q=rome', ALL);
	assert.equal(params(out).get('restrict_sr'), 'on');
	assert.equal(params(out).get('q'), 'rome');
});

test('restrict_sr is NOT applied to a site-wide search', () => {
	// reddit answers restrict_sr on /search with zero results, so applying it
	// there turns the feature into "search is broken" — the bug in the original
	// userscript.
	const out = ss.applySearchScope('/search?q=rome', ALL);
	assert.equal(params(out).get('restrict_sr'), null);
	// The other two still apply.
	assert.equal(params(out).get('include_over_18'), 'on');
	assert.equal(params(out).get('feature'), 'legacy_search');
});

test('nothing is touched when every option is off', () => {
	assert.equal(ss.applySearchScope('/r/aww/search?q=cat', NONE), '/r/aww/search?q=cat');
});

test('a non-search URL is returned untouched', () => {
	assert.equal(ss.applySearchScope('/r/aww/comments/abc/title/', ALL), '/r/aww/comments/abc/title/');
	assert.equal(ss.applySearchScope('/r/aww/', ALL), '/r/aww/');
	assert.equal(ss.applySearchScope('not a url at all', ALL), 'not a url at all');
});

test('existing query parameters survive', () => {
	const out = ss.applySearchScope('/r/aww/search?q=cat&sort=new&t=year', ALL);
	const p = params(out);
	assert.equal(p.get('q'), 'cat');
	assert.equal(p.get('sort'), 'new');
	assert.equal(p.get('t'), 'year');
	assert.equal(p.get('restrict_sr'), 'on');
});

test('a relative URL stays relative and an absolute one stays absolute', () => {
	// Rewriting a form action to an absolute URL changes which host the form
	// posts to if reddit serves the page from another subdomain.
	const relative = ss.applySearchScope('/r/aww/search?q=cat', ALL);
	assert.ok(relative.startsWith('/r/aww/search?'), relative);

	const absolute = ss.applySearchScope('https://old.reddit.com/r/aww/search?q=cat', ALL);
	assert.ok(absolute.startsWith('https://old.reddit.com/r/aww/search?'), absolute);
});

test('a fragment is preserved on a relative rewrite', () => {
	const out = ss.applySearchScope('/r/aww/search?q=cat#results', ALL);
	assert.ok(out.endsWith('#results'), out);
});

test('isSearchUrl and isSubredditSearch discriminate correctly', () => {
	assert.equal(ss.isSearchUrl('/search'), true);
	assert.equal(ss.isSearchUrl('/r/aww/search/'), true);
	assert.equal(ss.isSearchUrl('/r/aww/comments/x/search/'), false);
	assert.equal(ss.isSearchUrl('/r/searching'), false);

	assert.equal(ss.isSubredditSearch('/r/aww/search'), true);
	assert.equal(ss.isSubredditSearch('/search'), false);
});

test('the module writes form fields, not just the action URL', () => {
	// The search form submits as a GET, so scoping applied only to the action is
	// discarded the moment the browser serialises the form.
	assert.match(mod, /function fixForms\(\)/);
	assert.match(mod, /field\.type === 'checkbox'/, 'restrict_sr is rendered as a real checkbox on subreddit search pages');
	assert.match(mod, /module\.disabledByDefault = true/);
});
