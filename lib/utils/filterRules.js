/* @flow */
// Pure rule-evaluation helpers for the filterRules module. Kept dependency-free
// so they can be unit-tested without DOM/runtime.

export type FilterField = 'user' | 'subreddit' | 'domain' | 'keyword' | 'flair' | 'score' | 'commentCount';
export type FilterOp = 'equals' | 'contains' | 'regex' | 'lt' | 'gt';
export type FilterAction = 'hide' | 'dim' | 'collapse' | 'badge';

export type FilterRule = {|
	id: string,
	enabled: boolean,
	field: FilterField,
	op: FilterOp,
	value: string,
	action: FilterAction,
	target?: 'post' | 'comment' | 'both',
	// Compiled once when the rules are parsed. `null` means the pattern was
	// rejected — malformed, or shaped like one that backtracks catastrophically —
	// and a rejected pattern matches nothing rather than throwing at match time.
	// Absent on a rule whose op is not `regex`.
	compiled?: RegExp | null,
|};

export type ThingFacts = {|
	kind: 'post' | 'comment',
	user?: ?string,
	subreddit?: ?string,
	domain?: ?string,
	title?: ?string,
	body?: ?string,
	flair?: ?string,
	score?: ?number,
	commentCount?: ?number,
|};

const MAX_REGEX_LENGTH = 300;

// Heuristic ReDoS guard. JS has no regex-execution timeout, so a user-authored
// pattern like `(a+)+$` can hang the tab when tested against a long body. We
// reject over-long patterns and the common nested-quantifier shapes ((a+)+,
// (a*)*, (.+)* …). Fail-closed: an unsafe pattern yields no match rather than a
// hang, and there is no filter bypass (a rejected rule simply never fires).
export function isLikelyCatastrophicRegex(value: mixed): boolean {
	if (typeof value !== 'string') return true;
	if (value.length > MAX_REGEX_LENGTH) return true;
	// A parenthesised group that itself contains a quantifier and is then quantified.
	return /\([^()]*[+*][^()]*\)[?]?[+*]/.test(value);
}

function compileRegex(value: string): ?RegExp {
	if (isLikelyCatastrophicRegex(value)) return null;
	try { return new RegExp(value, 'i'); } catch (e) { return null; }
}

function fieldValue(rule: FilterRule, facts: ThingFacts): mixed {
	switch (rule.field) {
		case 'user': return facts.user;
		case 'subreddit': return facts.subreddit;
		case 'domain': return facts.domain;
		case 'keyword': return [facts.title, facts.body].filter(Boolean).join('\n');
		case 'flair': return facts.flair;
		case 'score': return facts.score;
		case 'commentCount': return facts.commentCount;
		default: return undefined;
	}
}

export function ruleMatches(rule: FilterRule, facts: ThingFacts): boolean {
	if (!rule.enabled) return false;
	if (rule.target && rule.target !== 'both' && rule.target !== facts.kind) return false;
	const value = fieldValue(rule, facts);
	if (value === undefined || value === null) return false;
	switch (rule.op) {
		case 'equals': return String(value).toLowerCase() === rule.value.toLowerCase();
		case 'contains': return String(value).toLowerCase().includes(rule.value.toLowerCase());
		case 'regex': {
			// Compiled in `parseRulesFromJson`, which runs once per settings change.
			// This used to call `compileRegex` here, so `isLikelyCatastrophicRegex`
			// and `new RegExp` ran for every rule against every post — and the
			// shipped default rule set contains an enabled regex rule, so that was
			// the default path for everyone: two compilations per post, two thousand
			// across a thousand-post scroll, for a pattern that never changes.
			//
			// `compileRegex` is still called for a rule that arrived without one, so
			// a caller that builds a rule object by hand behaves as it always did.
			const re = rule.compiled !== undefined ? rule.compiled : compileRegex(rule.value);
			return !!re && re.test(String(value));
		}
		case 'lt': return Number(value) < Number(rule.value);
		case 'gt': return Number(value) > Number(rule.value);
		default: return false;
	}
}

export function evaluateRules(rules: FilterRule[], facts: ThingFacts): FilterRule[] {
	return rules.filter(r => ruleMatches(r, facts));
}

export function parseRulesFromJson(raw: string): FilterRule[] {
	if (!raw || !raw.trim()) return [];
	let parsed;
	try { parsed = JSON.parse(raw); } catch (e) { return []; }
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(r => r && typeof r === 'object' && typeof r.field === 'string' && typeof r.op === 'string' && typeof r.value === 'string' && typeof r.action === 'string').map((r, i) => ({
		id: typeof r.id === 'string' ? r.id : `rule-${i}`,
		enabled: r.enabled !== false,
		field: r.field,
		op: r.op,
		value: r.value,
		action: r.action,
		target: r.target,
		// Rejected here rather than at match time, which is the only place the
		// rejection can be reported to the reader and the only place it costs
		// nothing.
		compiled: r.op === 'regex' ? compileRegex(r.value) : undefined,
	}));
}
