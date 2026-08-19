// Where current Reddit's page type comes from, and whether the words modules use
// to name a page exist on the renderer they will meet.
//
// Both halves are the same defect seen from two ends. `d2x` page types were
// derived from the same URL regexes old Reddit uses, so a route reddit has but
// the table does not — `/r/<sub>/s/<id>` share links are post pages — came out
// as a listing. And `r2` calls a profile `profile` while `d2x` calls it
// `profile2x`, so two modules declaring `['profile']` were silently absent from
// current-Reddit profiles while their settings entries said otherwise.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadModule } from './helpers/loadModule.mjs';
import { repoRoot, readRepoFile } from './helpers/loadFlowModule.mjs';

const SHREDDIT = '<!doctype html><html><body><shreddit-app routename="post_page" pagetype="post_detail"></shreddit-app></body></html>';

const Bundle = await loadModule('lib/utils/currentLocation.js', 'renderer-page-type', {
	dom: { url: 'https://www.reddit.com/r/example/s/AbCdEf1234', html: SHREDDIT },
	alsoExport: { location: 'lib/utils/location.js' },
});

const { pageType, appType } = Bundle;
const { appPageTypes, d2xPageTypeAttributes, d2xRouteNames } = Bundle.location;

function at(pathname, appMarkup) {
	window.history.replaceState({}, '', pathname);
	document.body.innerHTML = appMarkup === null ? '' : `<shreddit-app ${appMarkup}></shreddit-app>`;
	pageType.cache.clear();
	return pageType();
}

test('the fixture really is the redesign, or none of this measures anything', () => {
	// `appType()` is a `once` reading the xmlns attribute. Without this check a
	// missing marker would send every assertion below down the r2 branch, and
	// they would pass.
	assert.equal(appType(), 'd2x');
});

test('a share link is a post page, which the path alone cannot tell you', () => {
	// The defect, stated as a test. `/r/<sub>/s/<id>` matches no pattern in the
	// regex table, so without the attribute it falls to the `linklist` default
	// and every comments-scoped module sits the page out.
	assert.equal(at('/r/example/s/AbCdEf1234', 'routename="post_page" pagetype="post_detail"'), 'comments');
	assert.equal(at('/r/example/s/AbCdEf1234', null), 'linklist', 'the path-only answer is the one being corrected');
});

test('pagetype wins over routename, and routename is used when pagetype is unknown', () => {
	assert.equal(at('/r/example/', 'routename="subreddit" pagetype="post_detail"'), 'comments');
	// `subreddit` is not a page type this maps, so the answer comes from the route.
	assert.equal(at('/r/example/', 'routename="subreddit" pagetype="subreddit"'), 'linklist');
});

test('an unrecognised route falls back to the path rather than guessing', () => {
	// The table is deliberately partial. A route nobody has captured yet must cost
	// nothing, not produce a wrong answer with confidence.
	assert.equal(at('/r/example/comments/abc/title/', 'routename="something_new" pagetype="something_new"'), 'comments');
	assert.equal(at('/r/example/wiki/index', 'routename="something_new"'), 'wiki');
});

test('a fallback answer is not cached, so the real one can still arrive', () => {
	// `beforeLoad` can run before `shreddit-app` has been parsed. Caching the
	// path-derived guess there would pin it for the life of the page, which is
	// the whole reason this is not a plain memo.
	assert.equal(at('/r/example/s/AbCdEf1234', null), 'linklist');
	document.body.innerHTML = '<shreddit-app routename="post_page" pagetype="post_detail"></shreddit-app>';
	assert.equal(pageType(), 'comments', 'the guess outlived the element that could correct it');

	// Once it is authoritative it must stop changing, or two modules can disagree.
	document.body.innerHTML = '';
	assert.equal(pageType(), 'comments');
});

test('every mapped value names a page type the redesign actually declares', () => {
	const declared = new Set(appPageTypes.d2x.pageTypes.concat(appPageTypes.d2x.default || []));
	for (const [attribute, mapped] of Object.entries({ ...d2xPageTypeAttributes, ...d2xRouteNames })) {
		assert.ok(declared.has(mapped), `${attribute} maps to '${mapped}', which d2x does not declare`);
	}
});

// Every page type each module names, read off the source. A module's `include`
// is a literal array, so this reads it rather than importing 115 modules.
function declaredScopes() {
	const dir = path.join(repoRoot, 'lib', 'modules');
	const scopes = [];
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith('.js') || name === 'index.js') continue;
		const source = readRepoFile(`lib/modules/${name}`);
		for (const key of ['include', 'exclude']) {
			const match = new RegExp(`^module\\.${key} = \\[([^\\]]*)\\]`, 'm').exec(source);
			if (!match) continue;
			const tokens = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
			if (tokens.length) scopes.push({ module: name.replace(/\.js$/, ''), key, tokens });
		}
	}
	return scopes;
}

test('no two page types describe the same URL shape', () => {
	// The root cause, stated directly. `profile` and `profile2x` were
	// character-for-character identical and differed only in name, so `r2` and
	// `d2x` had two words for one page. Modules declaring `['profile']` read as
	// correct, shipped, and were absent from current-Reddit profiles with nothing
	// anywhere to say so. Two names for one URL shape is the condition that makes
	// that possible, so this forbids the condition rather than the symptom.
	const { regexes } = Bundle.location;
	const bySource = new Map();
	for (const [name, regex] of Object.entries(regexes)) {
		const key = String(regex);
		if (!bySource.has(key)) bySource.set(key, []);
		(bySource.get(key)).push(name);
	}
	const duplicates = [...bySource.values()].filter(names => names.length > 1);
	assert.deepEqual(duplicates, [], `page types sharing one pattern: ${JSON.stringify(duplicates)}`);
});

test('every page type a module names is one some renderer declares', () => {
	// A page type only one renderer has is fine — live threads exist on old
	// Reddit and nowhere else. A page type *no* renderer has is a typo that
	// silently disables the module, which is the same failure with no warning.
	const APP_TYPES = new Set(['r2', 'd2x', 'options']);
	const known = new Set(Object.values(appPageTypes).flatMap(spec => spec.pageTypes.concat(spec.default || [])));

	const problems = [];
	for (const { module, key, tokens } of declaredScopes()) {
		for (const token of tokens) {
			if (APP_TYPES.has(token) || known.has(token)) continue;
			problems.push(`${module}: ${key} names '${token}', which no renderer declares`);
		}
	}
	assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}\n`);
});

test('a renderer token next to a page type restricts nothing, and should not pretend to', () => {
	// `searchFilterPersist` declared `['search', 'r2']`. `matchesPageLocation` ORs
	// its include list, and `search` is a page type `d2x` declares too, so the
	// `'r2'` matched nothing the `'search'` had not already admitted. A reader
	// would take it for a restriction.
	const problems = [];
	for (const { module, key, tokens } of declaredScopes()) {
		if (key !== 'include') continue;
		const renderers = tokens.filter(t => t === 'r2' || t === 'd2x');
		const pages = tokens.filter(t => t !== 'r2' && t !== 'd2x' && t !== 'options');
		if (renderers.length && pages.length) {
			problems.push(`${module}: include mixes renderer ${renderers.join('/')} with page type ${pages.join('/')}; the renderer token restricts nothing`);
		}
	}
	assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}\n`);
});
