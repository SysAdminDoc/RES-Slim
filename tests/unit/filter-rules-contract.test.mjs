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

// --- one compilation per rule, not one per rule per post ---------------------
//
// `ruleMatches` called `compileRegex` inside the per-Thing evaluation, so
// `isLikelyCatastrophicRegex` and `new RegExp` ran for every rule against every
// post. The shipped default rule set contains an enabled regex rule, so that was
// the default path for everyone.

test('a regex rule is compiled when the rules are parsed, not when a post is judged', () => {
	const rules = parseRulesFromJson(JSON.stringify([
		{ id: 'r', field: 'keyword', op: 'regex', value: '^I\\s+built\\b', action: 'hide' },
	]));
	assert.equal(rules.length, 1);
	assert.ok(rules[0].compiled instanceof RegExp, 'the pattern has to be compiled up front');
	assert.equal(rules[0].compiled.flags.includes('i'), true, 'and keep the case-insensitive flag it always had');

	// Evaluating must reuse it rather than building another.
	const first = rules[0].compiled;
	evaluateRules(rules, { kind: 'post', title: 'I built a thing' });
	evaluateRules(rules, { kind: 'post', title: 'something else' });
	assert.equal(rules[0].compiled, first, 'evaluation must not replace the compiled pattern');
});

test('only a regex rule carries a compiled pattern', () => {
	const rules = parseRulesFromJson(JSON.stringify([
		{ id: 'a', field: 'user', op: 'equals', value: 'someone', action: 'hide' },
		{ id: 'b', field: 'keyword', op: 'contains', value: 'thing', action: 'dim' },
	]));
	assert.equal(rules[0].compiled, undefined);
	assert.equal(rules[1].compiled, undefined);
});

test('a pattern that is rejected is rejected once, and matches nothing', () => {
	// Malformed, and one shaped like a catastrophic backtracker. Both have to be
	// refused at parse time and behave as a rule that matches nothing — never as
	// a throw during evaluation, which would take the whole filter pass down.
	const rules = parseRulesFromJson(JSON.stringify([
		{ id: 'broken', field: 'keyword', op: 'regex', value: '([a-z]+)+$', action: 'hide' },
		{ id: 'malformed', field: 'keyword', op: 'regex', value: '(unclosed', action: 'hide' },
	]));
	assert.equal(rules[0].compiled, null, 'a catastrophic pattern must be rejected at parse time');
	assert.equal(rules[1].compiled, null, 'a malformed pattern must be rejected at parse time');

	assert.deepEqual(evaluateRules(rules, { kind: 'post', title: 'aaaaaaaaaaaaaaaaaaaaaaaaa!' }), [],
		'a rejected pattern matches nothing rather than throwing');
});

test('a rule built by hand still works, so a caller that skips the parser is not broken', () => {
	// `compiled` is absent rather than null on such a rule, and absent means "work
	// it out", where null means "already rejected".
	const byHand = [{ id: 'x', enabled: true, field: 'keyword', op: 'regex', value: 'built', action: 'hide' }];
	assert.deepEqual(evaluateRules(byHand, { kind: 'post', title: 'I built a thing' }).map(r => r.id), ['x']);
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
