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
	'firefox/beta/manifest.json',
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

	for (const rule of rules) {
		assert.equal(rule.action.type, 'block', `rule ${rule.id} must be block-only`);
		assert.deepEqual(rule.condition.initiatorDomains, ['reddit.com'], `rule ${rule.id} must stay scoped to Reddit pages`);
		assert.ok(
			rule.condition.excludedResourceTypes?.includes('main_frame') || !rule.condition.resourceTypes?.includes('main_frame'),
			`rule ${rule.id} must never block top-level navigation`,
		);
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
});
