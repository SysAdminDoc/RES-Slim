import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import flowRemoveTypes from 'flow-remove-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'lib/utils/filterRules.js'), 'utf8');
const tmpDir = path.join(repoRoot, 'tests', 'unit', '.tmp-filter');
fs.mkdirSync(tmpDir, { recursive: true });
const stripped = flowRemoveTypes(source, { all: true }).toString();
const modulePath = path.join(tmpDir, 'filter.mjs');
fs.writeFileSync(modulePath, stripped);

const { ruleMatches, evaluateRules, parseRulesFromJson, isLikelyCatastrophicRegex } = await import(pathToFileURL(modulePath).href);

const rule = (over = {}) => ({ id: 'r', enabled: true, field: 'user', op: 'equals', value: 'spammer', action: 'hide', target: 'both', ...over });
const facts = (over = {}) => ({ kind: 'post', user: 'alice', subreddit: 'pics', domain: 'i.imgur.com', title: 'hello world', flair: '', score: 5, commentCount: 12, ...over });

test('isLikelyCatastrophicRegex rejects nested-quantifier and over-long patterns', () => {
	assert.equal(isLikelyCatastrophicRegex('(a+)+'), true);
	assert.equal(isLikelyCatastrophicRegex('(a*)*'), true);
	assert.equal(isLikelyCatastrophicRegex('(.+)*'), true);
	assert.equal(isLikelyCatastrophicRegex('x'.repeat(301)), true);
	assert.equal(isLikelyCatastrophicRegex('^hello$'), false);
	assert.equal(isLikelyCatastrophicRegex('(cat|dog)s?'), false);
});

test('a catastrophic user regex fails closed (no match, no hang)', () => {
	assert.equal(ruleMatches(rule({ field: 'keyword', op: 'regex', value: '(a+)+$' }), facts({ title: `${'a'.repeat(40)}!` })), false);
});

test('ruleMatches handles equals/contains/regex/lt/gt against the right fields', () => {
	assert.equal(ruleMatches(rule({ value: 'alice' }), facts()), true);
	assert.equal(ruleMatches(rule({ value: 'bob' }), facts()), false);
	assert.equal(ruleMatches(rule({ field: 'keyword', op: 'contains', value: 'world' }), facts()), true);
	assert.equal(ruleMatches(rule({ field: 'keyword', op: 'regex', value: '^hello' }), facts()), true);
	assert.equal(ruleMatches(rule({ field: 'score', op: 'lt', value: '10' }), facts()), true);
	assert.equal(ruleMatches(rule({ field: 'score', op: 'gt', value: '10' }), facts()), false);
	assert.equal(ruleMatches(rule({ field: 'commentCount', op: 'gt', value: '5' }), facts()), true);
});

test('ruleMatches respects enabled + target filters', () => {
	assert.equal(ruleMatches(rule({ enabled: false, value: 'alice' }), facts()), false);
	assert.equal(ruleMatches(rule({ target: 'comment', value: 'alice' }), facts({ kind: 'post' })), false);
	assert.equal(ruleMatches(rule({ target: 'comment', value: 'alice' }), facts({ kind: 'comment' })), true);
});

test('regex compilation fails closed (no throw, no match)', () => {
	assert.equal(ruleMatches(rule({ field: 'keyword', op: 'regex', value: '(unterminated' }), facts()), false);
});

test('evaluateRules returns every match in input order', () => {
	const matches = evaluateRules([
		rule({ id: 'a', value: 'alice' }),
		rule({ id: 'b', field: 'subreddit', value: 'pics' }),
		rule({ id: 'c', field: 'user', value: 'bob' }),
	], facts());
	assert.deepEqual(matches.map(m => m.id), ['a', 'b']);
});

test('parseRulesFromJson rejects malformed input gracefully', () => {
	assert.deepEqual(parseRulesFromJson(''), []);
	assert.deepEqual(parseRulesFromJson('not-json'), []);
	assert.deepEqual(parseRulesFromJson('{}'), []);
	assert.deepEqual(parseRulesFromJson('[null, {"bogus":true}]'), []);
});

test('parseRulesFromJson normalises ids and defaults enabled to true', () => {
	const parsed = parseRulesFromJson(JSON.stringify([
		{ field: 'user', op: 'equals', value: 'alice', action: 'hide' },
		{ id: 'custom', field: 'subreddit', op: 'equals', value: 'gaming', action: 'dim', enabled: false },
	]));
	assert.equal(parsed[0].id, 'rule-0');
	assert.equal(parsed[0].enabled, true);
	assert.equal(parsed[1].id, 'custom');
	assert.equal(parsed[1].enabled, false);
});

test('default rulesJson hides posts whose titles begin with "I built"', () => {
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/filterRules.js'), 'utf8');
	const match = mod.match(/const DEFAULT_RULES_JSON = '(\[.*\])';/);
	assert.ok(match, 'expected DEFAULT_RULES_JSON literal in filterRules module');
	// Undo JS source escaping ('\\\\' in source is '\\' in the runtime string).
	const defaultJson = match[1].replace(/\\\\/g, '\\');
	const rules = parseRulesFromJson(defaultJson);
	assert.equal(rules.length, 1);
	assert.equal(rules[0].id, 'i-built');
	assert.equal(rules[0].action, 'hide');
	assert.equal(rules[0].target, 'post');

	const post = title => facts({ title });
	assert.equal(evaluateRules(rules, post('I built an open-source dashboard for my homelab')).length, 1);
	assert.equal(evaluateRules(rules, post('i built a browser extension in a weekend')).length, 1);
	// Anchored at the start of the title, whole-word "built" only.
	assert.equal(evaluateRules(rules, post('So I built something over the weekend')).length, 0);
	assert.equal(evaluateRules(rules, post('I builtin support for plugins')).length, 0);
	assert.equal(evaluateRules(rules, post('New study finds dark matter may interact with photons')).length, 0);
	// Post-only: a comment starting with "I built" is untouched.
	assert.equal(evaluateRules(rules, facts({ kind: 'comment', title: undefined, body: 'I built one of these too' })).length, 0);
});

test('filterRules module is registered and uses the utility helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as filterRules \} from '\.\/filterRules';/);
	assert.match(index, /^\s*filterRules,/m);
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/filterRules.js'), 'utf8');
	assert.match(mod, /import \{ evaluateRules, parseRulesFromJson \} from '\.\.\/utils\/filterRules'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	assert.match(mod, /watchForThings\(\['comment'\]/);
	for (const action of ['hide', 'dim', 'collapse', 'badge']) {
		assert.ok(mod.includes(`case '${action}'`), `expected action ${action}`);
	}
});
