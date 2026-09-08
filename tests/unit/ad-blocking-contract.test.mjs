import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const readJson = file => JSON.parse(read(file));

const manifests = [
	'chrome/manifest.json',
	'firefox/manifest.json',
];

test('both supported browsers enable the packaged Reddit ad-block ruleset', () => {
	for (const file of manifests) {
		const manifest = readJson(file);
		assert.ok(manifest.permissions.includes('declarativeNetRequest'), `${file} must grant block-only DNR access`);
		assert.deepEqual(manifest.declarative_net_request.rule_resources, [{
			id: 'reddit_ads',
			enabled: true,
			path: 'ad-block.json',
		}], `${file} must enable the same static ruleset`);
	}

	assert.match(read('build.js'), /\.\/rules\/ad-block\.json/);
});

test('the static rules block only Reddit-initiated ad and measurement subresources', () => {
	const rules = readJson('rules/ad-block.json');
	assert.ok(rules.length >= 6, 'expected explicit tracker, analytics, ad-asset, pixel, and ads-host rules');
	assert.equal(new Set(rules.map(({ id }) => id)).size, rules.length, 'rule IDs must be unique');

	// Three action types, and no others. `block` and `allow` are self-explanatory;
	// `redirect` is here only to strip tracking parameters off a reddit URL, which
	// is the one thing in this file that changes a request rather than refusing
	// it. A redirect to an arbitrary URL is a different and much larger power --
	// it can send a navigation anywhere -- so the only redirect shape permitted is
	// a `queryTransform` that removes parameters.
	for (const rule of rules) {
		assert.ok(['block', 'allow', 'redirect'].includes(rule.action.type), `rule ${rule.id} has action ${rule.action.type}`);
		if (rule.action.type === 'redirect') {
			const redirect = rule.action.redirect || {};
			assert.deepEqual(Object.keys(redirect), ['transform'], `rule ${rule.id} may only transform, never point elsewhere`);
			assert.deepEqual(Object.keys(redirect.transform), ['queryTransform'],
				`rule ${rule.id} may only change the query string`);
			assert.deepEqual(Object.keys(redirect.transform.queryTransform), ['removeParams'],
				`rule ${rule.id} may only remove parameters, never add or replace one`);
		}

		// Scoped to reddit either way round: a subresource a reddit page asked for,
		// or a navigation to reddit itself. A rule with neither would apply to the
		// whole web.
		const scoped = rule.condition.initiatorDomains || rule.condition.requestDomains;
		assert.deepEqual(scoped, ['reddit.com'], `rule ${rule.id} must stay scoped to Reddit`);

		// Never *block* a top-level navigation. The parameter-stripping rule does
		// act on `main_frame`, which is the only way to strip a parameter before
		// the document is requested, and that is a redirect rather than a refusal.
		if (rule.action.type === 'block') {
			assert.ok(
				rule.condition.excludedResourceTypes?.includes('main_frame') || !rule.condition.resourceTypes?.includes('main_frame'),
				`rule ${rule.id} must never block top-level navigation`,
			);
		}
	}

	const coveredHosts = new Set(rules.flatMap(rule => rule.condition.requestDomains || []));
	for (const host of [
		'alb.reddit.com',
		'e.reddit.com',
		'events.reddit.com',
		'events.redditmedia.com',
		'pixel.redditmedia.com',
		'w3-reporting.reddit.com',
		'ads.reddit.com',
	]) assert.ok(coveredHosts.has(host), `missing observed ad/measurement host ${host}`);

	const serialized = JSON.stringify(rules);
	assert.match(serialized, /about-this-ad/);
	assert.match(serialized, /shreddit\/assets\/pix\/ads/);
	assert.match(serialized, /static\/pixel\.png/);
	assert.match(serialized, /page_view/);
	assert.match(serialized, /v1\/\(\?:page_view\|clk\)/);

	// The hosts the maintained lists carry and this set did not, read from
	// uAssets `filters/privacy.txt` and AdGuard Annoyances 14.txt on 2026-09-08.
	for (const host of ['pi.reddit.com', 'redditpagematrics.com']) {
		assert.ok(coveredHosts.has(host), `missing measurement host ${host}`);
	}
	assert.match(serialized, /PushNotifications/);
});

test('the parameter-stripping rule fires only when a tracked parameter is there', () => {
	// A rule that matched every reddit navigation would ask the browser to
	// redirect one to itself on every page load. Chrome skips a transform that
	// produces the same URL, but relying on that is relying on an implementation
	// detail to avoid a redirect loop; the condition says what it means instead.
	const rules = readJson('rules/ad-block.json');
	const stripper = rules.find(rule => rule.action.type === 'redirect');
	assert.ok(stripper, 'the tracking-parameter rule is missing');

	const removed = stripper.action.redirect.transform.queryTransform.removeParams;
	for (const param of ['correlation_id', 'ref', 'ref_campaign', 'ref_source', 'utm_content', 'web_only', 'deep_link', 'recap_redirect']) {
		assert.ok(removed.includes(param), `${param} is stripped by uBlock Origin or AdGuard on reddit.com and not here`);
	}

	const matches = new RegExp(stripper.condition.regexFilter);
	for (const url of [
		'https://www.reddit.com/r/pics/?correlation_id=x&ref=share&utm_content=y',
		'https://www.reddit.com/r/pics/?after=t3_1&ref_source=share',
		'https://old.reddit.com/?web_only=1',
	]) assert.equal(matches.test(url), true, `${url} carries a tracked parameter and must be rewritten`);

	for (const url of [
		'https://www.reddit.com/r/pics/',
		'https://www.reddit.com/r/pics/?sort=new',
		// `ref` as a *value*, not a parameter. Matching this would rewrite a search.
		'https://www.reddit.com/search/?q=ref',
		// And in the fragment, which never reaches the server.
		'https://www.reddit.com/r/pics/#ref=x',
	]) assert.equal(matches.test(url), false, `${url} carries none, and must be left alone`);
});
