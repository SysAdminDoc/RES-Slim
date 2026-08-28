import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFlowModule } from './helpers/loadFlowModule.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const redirect = await loadFlowModule('lib/utils/oldRedditRedirect.js', 'old-reddit-redirect');

test('oldRedditRedirect is registered in the module index', () => {
	const index = read('lib/modules/index.js');
	assert.match(index, /import \{ module as oldRedditRedirect \} from '\.\/oldRedditRedirect';/);
	assert.match(index, /^\s*oldRedditRedirect,/m);
});

test('oldRedditRedirect defaults autoRedirect off and toggle on', () => {
	const source = read('lib/modules/oldRedditRedirect.js');
	assert.match(source, /autoRedirect:\s*\{[\s\S]*?value:\s*false/);
	assert.match(source, /showHostToggle:\s*\{[\s\S]*?value:\s*true/);
});

test('oldRedditRedirect keeps a foreground fallback for request-rule startup races', () => {
	const source = read('lib/modules/oldRedditRedirect.js');
	assert.match(source, /oldRedditUrl\(location\.href\)/);
	assert.match(source, /location\.replace/);
});

test('redirect policy preserves route state and excludes sensitive hosts and paths', () => {
	const source = 'https://www.reddit.com/r/codex/comments/abc/title/?sort=new#comment-1';
	assert.equal(
		redirect.oldRedditUrl(source),
		'https://old.reddit.com/r/codex/comments/abc/title/?sort=new#comment-1',
	);

	for (const url of [
		'https://old.reddit.com/r/codex/',
		'https://sh.reddit.com/r/codex/',
		'https://www.reddit.com/login/',
		'https://www.reddit.com/account/register',
		'https://www.reddit.com/ads/create',
		'https://www.reddit.com/api/v1/authorize?client_id=test',
		'https://www.reddit.com/r/codex/?res_slim_redirect=off',
	]) {
		assert.equal(redirect.shouldRedirectToOld(url), false, `must not redirect ${url}`);
		assert.equal(redirect.oldRedditUrl(url), null, `must not build a redirect for ${url}`);
	}
});

test('host toggle hands the tab over with an escape parameter, without polluting old or sh links', () => {
	const source = 'https://old.reddit.com/r/codex/?sort=top#details';
	assert.equal(
		redirect.hostToggleUrl(source, 'www.reddit.com', true),
		'https://www.reddit.com/r/codex/?sort=top&res_slim_redirect=off#details',
	);
	assert.equal(
		redirect.hostToggleUrl('https://www.reddit.com/r/codex/?res_slim_redirect=off', 'old.reddit.com', true),
		'https://old.reddit.com/r/codex/',
	);
});

test('the escape parameter is a handover, not the escape itself', () => {
	// The parameter survives exactly one request. Current Reddit is a single-page
	// app, so the first in-page navigation drops it, and reddit's own redirects -
	// the bot challenge rewrites the query entirely - drop it too. Whatever reads
	// it has to convert it into something with a longer life, which is why this is
	// exported rather than being an inline check inside `shouldRedirectToOld`.
	assert.equal(redirect.hasRedirectEscapeParam('https://www.reddit.com/r/codex/?res_slim_redirect=off'), true);
	assert.equal(redirect.hasRedirectEscapeParam('https://www.reddit.com/r/codex/'), false);
	assert.equal(redirect.hasRedirectEscapeParam('https://www.reddit.com/r/codex/?res_slim_redirect=on'), false);
	assert.equal(redirect.hasRedirectEscapeParam('not a url'), false);

	// The shape reddit's challenge leaves behind: same page, parameter gone.
	assert.equal(redirect.hasRedirectEscapeParam('https://www.reddit.com/r/codex/?solution=abc&js_challenge=1'), false);
	assert.equal(redirect.shouldRedirectToOld('https://www.reddit.com/r/codex/?solution=abc&js_challenge=1'), true);
});

test('the host escape is scoped to tabs and outranks the redirect rule', () => {
	const rule = redirect.buildHostEscapeRule([7, 12]);
	assert.equal(rule.id, redirect.HOST_ESCAPE_RULE_ID);
	assert.equal(rule.action.type, 'allow');
	assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
	assert.equal(rule.condition.urlFilter, '|https://www.reddit.com/');
	assert.deepEqual(rule.condition.tabIds, [7, 12]);

	// Above every rule in the persistent set, or a tab that asked to stay would be
	// redirected anyway.
	const highest = Math.max(...redirect.buildOldRedditRedirectRules().map(r => r.priority));
	assert.ok(rule.priority > highest, `escape priority ${rule.priority} must beat ${highest}`);

	// The id must not collide with the persistent rules, which are written and
	// removed by id in a separate call.
	assert.ok(!redirect.OLD_REDDIT_DYNAMIC_RULE_IDS.includes(redirect.HOST_ESCAPE_RULE_ID));

	// Copied, not aliased: the caller holds a Set it keeps mutating.
	const tabs = [3];
	const built = redirect.buildHostEscapeRule(tabs);
	tabs.push(4);
	assert.deepEqual(built.condition.tabIds, [3]);
});

test('dynamic DNR rules are opt-in, main-frame-only, and replace only the host', () => {
	const rules = redirect.buildOldRedditRedirectRules();
	assert.deepEqual(rules.map(rule => rule.id), redirect.OLD_REDDIT_DYNAMIC_RULE_IDS);
	assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length);
	assert.deepEqual(rules.map(rule => rule.condition.resourceTypes), rules.map(() => ['main_frame']));

	const redirectRule = rules.find(rule => rule.action.type === 'redirect');
	assert.ok(redirectRule);
	assert.equal(redirectRule.priority, 1);
	assert.equal(redirectRule.condition.urlFilter, '|https://www.reddit.com/');
	assert.deepEqual(redirectRule.action.redirect.transform, { scheme: 'https', host: 'old.reddit.com' });

	const allowRules = rules.filter(rule => rule.action.type === 'allow');
	assert.equal(allowRules.length, 2);
	assert.ok(allowRules.every(rule => rule.priority > redirectRule.priority));
});

test('stored preference and module state both gate the persistent redirect rule', () => {
	const enabled = {
		'RESoptions.oldRedditRedirect': { autoRedirect: { value: true } },
	};
	assert.equal(redirect.storedAutoRedirectEnabled(enabled), true, 'module defaults enabled when no override exists');
	assert.equal(redirect.storedAutoRedirectEnabled({
		...enabled,
		'RES.modulePrefs': { oldRedditRedirect: false },
	}), false, 'disabling the module removes the rule');
	assert.equal(redirect.storedAutoRedirectEnabled({
		'RESoptions.oldRedditRedirect': { autoRedirect: { value: false } },
	}), false, 'the option remains off by default');
});

test('oldRedditRedirect injects an old/www/sh host toggle with active-state marking', () => {
	const source = read('lib/modules/oldRedditRedirect.js');
	for (const host of ['old.reddit.com', 'www.reddit.com', 'sh.reddit.com']) {
		assert.ok(source.includes(`'${host}'`), `expected host ${host}`);
	}
	assert.match(source, /classList\.add\('is-active'\)/);
	assert.match(source, /hostToggleUrl\(location\.href, targetHost/);
	const css = read('lib/css/modules/_oldRedditRedirect.scss');
	assert.match(css, /\.rsm-host-toggle/);
	// The point of this assertion is the no-pill rule, so check that directly
	// rather than pinning one literal. Radii come from the shared scale.
	assert.match(css, /border-radius: var\(--rsm-radius-xs\)/);
	assert.doesNotMatch(css, /border-radius:\s*(9{3,}px|50%|100%)/);
});

test('no shipped in-page surface uses a pill or fully-rounded backdrop', () => {
	// Only partials res.scss actually imports, so an unreferenced leftover can
	// never fail this for a rule that does not ship.
	const res = read('lib/css/res.scss');
	const shipped = [...res.matchAll(/@import 'modules\/(\w+)';/g)].map(m => `_${m[1]}.scss`);
	assert.ok(shipped.length > 20, `expected the module imports to be found, got ${shipped.length}`);

	const offenders = [];
	for (const file of shipped) {
		const full = path.join(repoRoot, 'lib/css/modules', file);
		if (!fs.existsSync(full)) continue;
		const css = fs.readFileSync(full, 'utf8');
		for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
			if (/9{3,}px|50%|100%/.test(value)) offenders.push(`${file}: ${value.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], `pill radii found:\n${offenders.join('\n')}`);
});

test('oldRedditRedirect CSS partial is wired into res.scss', () => {
	const res = read('lib/css/res.scss');
	assert.match(res, /@import 'modules\/oldRedditRedirect';/);
});
