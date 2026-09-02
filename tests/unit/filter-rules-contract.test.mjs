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

const { ruleMatches, evaluateRules, parseRulesFromJson, parseFilterRules, serializeFilterRules, conditionMatches, isLikelyCatastrophicRegex, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES, FILTER_SCHEMA_VERSION } = await import(pathToFileURL(modulePath).href);

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

test('a rejected pattern takes its rule out of the set and says why', () => {
	// Malformed, and one shaped like a catastrophic backtracker. Both are refused
	// at parse time — never as a throw during evaluation, which would take the
	// whole filter pass down with it.
	//
	// This used to keep the rule with a null pattern, which matched nothing. That
	// was safe and invisible: in a list of rules, one that can never fire looks
	// exactly like one that works. Now it is dropped and named, because the
	// editor has somewhere to put the reason.
	const parsed = parseFilterRules(JSON.stringify([
		{ id: 'broken', field: 'keyword', op: 'regex', value: '([a-z]+)+$', action: 'hide' },
		{ id: 'malformed', field: 'keyword', op: 'regex', value: '(unclosed', action: 'hide' },
		{ id: 'fine', field: 'user', op: 'equals', value: 'alice', action: 'hide' },
	]));
	assert.deepEqual(parsed.rules.map(r => r.id), ['fine'], 'one bad rule must not take the set with it');
	assert.equal(parsed.errors.length, 2);
	for (const message of parsed.errors) assert.match(message, /rejected as unsafe or invalid/);

	assert.deepEqual(evaluateRules(parsed.rules, { kind: 'post', title: 'aaaaaaaaaaaaaaaaaaaaaaaaa!' }), [],
		'a rejected pattern matches nothing rather than throwing');
});

test('a rule built by hand still works, so a caller that skips the parser is not broken', () => {
	// `compiled` is absent rather than null on such a rule, and absent means "work
	// it out", where null means "already rejected".
	const byHand = [{ id: 'x', enabled: true, field: 'keyword', op: 'regex', value: 'built', action: 'hide' }];
	assert.deepEqual(evaluateRules(byHand, { kind: 'post', title: 'I built a thing' }).map(r => r.id), ['x']);
});

// --- schema v2 --------------------------------------------------------------
//
// One flat condition per rule could not say "this flair, but only in this
// subreddit". Every fact needed was already collected; there was nowhere to
// write the sentence.

const post = over => facts({ kind: 'post', ...over });

test('nested all/any/not groups read the facts they are given', () => {
	const condition = {
		all: [
			{ field: 'subreddit', op: 'equals', value: 'pics' },
			{ any: [
				{ field: 'flair', op: 'equals', value: 'OC' },
				{ field: 'flair', op: 'equals', value: 'Original' },
			] },
			{ not: { field: 'user', op: 'equals', value: 'alice' } },
		],
	};
	const { rules, errors } = parseFilterRules(JSON.stringify([{ id: 'oc', action: 'hide', condition }]));
	assert.deepEqual(errors, []);
	const [rule] = rules;

	// The whole point: the same flair in another subreddit is left alone.
	assert.equal(ruleMatches(rule, post({ subreddit: 'pics', flair: 'OC', user: 'bob' })), true);
	assert.equal(ruleMatches(rule, post({ subreddit: 'aww', flair: 'OC', user: 'bob' })), false);
	assert.equal(ruleMatches(rule, post({ subreddit: 'pics', flair: 'Meta', user: 'bob' })), false);
	// And `not` still excludes.
	assert.equal(ruleMatches(rule, post({ subreddit: 'pics', flair: 'OC', user: 'alice' })), false);
});

test('a group is evaluated, not merely accepted', () => {
	// `any` is a real disjunction and `all` a real conjunction, against the same
	// facts, so a parser that collapsed either to its first child would show up.
	const anyOf = { any: [{ field: 'score', op: 'lt', value: '0' }, { field: 'user', op: 'equals', value: 'alice' }] };
	const allOf = { all: [{ field: 'score', op: 'lt', value: '0' }, { field: 'user', op: 'equals', value: 'alice' }] };
	const given = post({ user: 'alice', score: 5 });
	assert.equal(conditionMatches(anyOf, given), true);
	assert.equal(conditionMatches(allOf, given), false);
	assert.equal(conditionMatches({ not: anyOf }, given), false);
	assert.equal(conditionMatches({ not: allOf }, given), true);
});

test('the target still gates a compound rule, on both renderers\u2019 facts', () => {
	const { rules: [rule] } = parseFilterRules(JSON.stringify([{
		id: 'comments-only',
		action: 'collapse',
		target: 'comment',
		condition: { all: [{ field: 'subreddit', op: 'equals', value: 'pics' }, { field: 'score', op: 'lt', value: '0' }] },
	}]));
	assert.equal(ruleMatches(rule, { kind: 'comment', subreddit: 'pics', score: -3 }), true);
	assert.equal(ruleMatches(rule, { kind: 'post', subreddit: 'pics', score: -3 }), false);
});

test('a tree deeper or wider than the limits is refused whole, with a reason', () => {
	let deep = { field: 'user', op: 'equals', value: 'alice' };
	Array.from({ length: MAX_CONDITION_DEPTH + 1 }).forEach(() => { deep = { all: [deep] }; });
	const tooDeep = parseFilterRules(JSON.stringify([{ id: 'deep', action: 'hide', condition: deep }]));
	assert.deepEqual(tooDeep.rules, []);
	assert.match(tooDeep.errors[0], /nested more than 5 deep/);

	const wide = { any: Array.from({ length: MAX_CONDITION_NODES + 1 }, (_, i) => ({ field: 'user', op: 'equals', value: `u${i}` })) };
	const tooWide = parseFilterRules(JSON.stringify([{ id: 'wide', action: 'hide', condition: wide }]));
	assert.deepEqual(tooWide.rules, []);
	assert.match(tooWide.errors[0], /more than 64 conditions/);

	// A tree that sits inside both limits is accepted, so the limits are limits
	// and not a blanket refusal.
	let deepEnough = { field: 'user', op: 'equals', value: 'alice' };
	Array.from({ length: MAX_CONDITION_DEPTH - 1 }).forEach(() => { deepEnough = { all: [deepEnough] }; });
	const ok = parseFilterRules(JSON.stringify([{ id: 'ok', action: 'hide', condition: deepEnough }]));
	assert.deepEqual(ok.errors, []);
	assert.equal(ruleMatches(ok.rules[0], post({ user: 'alice' })), true);
});

test('an empty or malformed group is refused rather than quietly always-matching', () => {
	// An empty `all` is vacuously true, which as a hide rule would take the whole
	// page down.
	for (const [label, condition] of [
		['empty all', { all: [] }],
		['empty any', { any: [] }],
		['not a condition', { all: ['nope'] }],
		['unknown field', { field: 'karma', op: 'equals', value: '1' }],
		['unknown op', { field: 'user', op: 'startsWith', value: 'a' }],
	]) {
		const parsed = parseFilterRules(JSON.stringify([{ id: label, action: 'hide', condition }]));
		assert.deepEqual(parsed.rules, [], `${label} must not produce a rule`);
		assert.equal(parsed.errors.length, 1, `${label} must say why`);
	}

	const badAction = parseFilterRules(JSON.stringify([{ id: 'x', action: 'destroy', condition: { field: 'user', op: 'equals', value: 'a' } }]));
	assert.deepEqual(badAction.rules, []);
	assert.match(badAction.errors[0], /is not an action/);
});

test('a catastrophic pattern is refused wherever it is nested', () => {
	const parsed = parseFilterRules(JSON.stringify([{
		id: 'nested-redos',
		action: 'hide',
		condition: { any: [
			{ field: 'user', op: 'equals', value: 'alice' },
			{ all: [{ field: 'keyword', op: 'regex', value: '([a-z]+)+$' }] },
		] },
	}]));
	assert.deepEqual(parsed.rules, [], 'a rule is not half-applied around a rejected branch');
	assert.match(parsed.errors[0], /rejected as unsafe or invalid/);
});

test('every valid v1 rule migrates without a change of meaning, and exports as v2', () => {
	const v1 = [
		{ id: 'a', field: 'user', op: 'equals', value: 'spammer', action: 'hide', target: 'both' },
		{ id: 'b', enabled: false, field: 'score', op: 'lt', value: '0', action: 'dim' },
		{ id: 'c', field: 'keyword', op: 'regex', value: '^I\\s+built\\b', action: 'hide', target: 'post' },
	];
	const parsed = parseFilterRules(JSON.stringify(v1));
	assert.deepEqual(parsed.errors, []);
	assert.equal(parsed.schemaVersion, FILTER_SCHEMA_VERSION);

	// Same verdict as the flat rule gave, on old-Reddit and current-Reddit facts
	// alike — the facts are the same objects either renderer produces.
	const cases = [
		post({ user: 'spammer' }),
		post({ user: 'bob', score: -4 }),
		post({ user: 'bob', title: 'I built a thing' }),
		{ kind: 'comment', user: 'spammer', subreddit: 'pics', score: 3 },
		{ kind: 'comment', user: 'bob', subreddit: 'pics', body: 'I built a thing', score: 3 },
	];
	for (const given of cases) {
		assert.deepEqual(
			evaluateRules(parsed.rules, given).map(r => r.id),
			evaluateRules(v1.map(r => ({ ...r, enabled: r.enabled !== false })), given).map(r => r.id),
			`v1 and v2 must agree on ${JSON.stringify(given)}`,
		);
	}

	// A v1 rule keeps its flat triple readable, so a caller holding the object
	// does not have to know it grew a condition.
	assert.equal(parsed.rules[0].field, 'user');
	assert.equal(parsed.rules[0].op, 'equals');

	// Exported as the envelope, and the export round-trips to the same verdicts.
	const exported = serializeFilterRules(parsed.rules);
	const envelope = JSON.parse(exported);
	assert.equal(envelope.schemaVersion, FILTER_SCHEMA_VERSION);
	assert.deepEqual(envelope.rules.map(r => r.id), ['a', 'b', 'c']);
	assert.deepEqual(envelope.rules[0].condition, { field: 'user', op: 'equals', value: 'spammer' });
	assert.equal(envelope.rules[1].enabled, false);

	const reparsed = parseFilterRules(exported);
	assert.deepEqual(reparsed.errors, []);
	for (const given of cases) {
		assert.deepEqual(
			evaluateRules(reparsed.rules, given).map(r => r.id),
			evaluateRules(parsed.rules, given).map(r => r.id),
			'a round trip through the export must not change a verdict',
		);
	}
	// And a second trip is byte-identical, so the export is a fixed point.
	assert.equal(serializeFilterRules(reparsed.rules), exported);
});

test('a schema version this build does not read is refused whole', () => {
	const parsed = parseFilterRules(JSON.stringify({ schemaVersion: 99, rules: [] }));
	assert.deepEqual(parsed.rules, []);
	assert.match(parsed.errors[0], /declare schema 99/);

	// The envelope may also declare 1: a v1 array wrapped in an envelope is still
	// a set of v1 rules, and reads as one.
	const wrappedV1 = parseFilterRules(JSON.stringify({
		schemaVersion: 1,
		rules: [{ id: 'a', field: 'user', op: 'equals', value: 'alice', action: 'hide' }],
	}));
	assert.deepEqual(wrappedV1.errors, []);
	assert.equal(ruleMatches(wrappedV1.rules[0], post({ user: 'alice' })), true);
});

test('filterRules module is registered and uses the utility helpers', () => {
	const index = fs.readFileSync(path.join(repoRoot, 'lib/modules/index.js'), 'utf8');
	assert.match(index, /import \{ module as filterRules \} from '\.\/filterRules';/);
	assert.match(index, /^\s*filterRules,/m);
	const mod = fs.readFileSync(path.join(repoRoot, 'lib/modules/filterRules.js'), 'utf8');
	assert.match(mod, /import \{ evaluateRules, parseFilterRules \} from '\.\.\/utils\/filterRules'/);
	assert.match(mod, /watchForThings\(\['post'\]/);
	assert.match(mod, /watchForThings\(\['comment'\]/);
	for (const action of ['hide', 'dim', 'collapse', 'badge']) {
		assert.ok(mod.includes(`case '${action}'`), `expected action ${action}`);
	}
});
