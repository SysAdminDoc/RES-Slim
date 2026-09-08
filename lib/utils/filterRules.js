/* @flow */
// Pure rule-evaluation helpers for the filterRules module. Kept dependency-free
// so they can be unit-tested without DOM/runtime.

export type FilterField = 'user' | 'subreddit' | 'domain' | 'keyword' | 'flair' | 'score' | 'commentCount';
export type FilterOp = 'equals' | 'contains' | 'regex' | 'lt' | 'gt';
export type FilterAction = 'hide' | 'dim' | 'collapse' | 'badge';

// A leaf test, and the three ways of combining them. One flat condition per
// rule could not say "this flair, but only in this subreddit" — the facts were
// all collected, there was just nowhere to write the sentence.
export type FilterLeaf = {|
	field: FilterField,
	op: FilterOp,
	value: string,
	// Compiled once when the rules are parsed. `null` means the pattern was
	// rejected — malformed, or shaped like one that backtracks catastrophically —
	// and a rejected pattern matches nothing rather than throwing at match time.
	// Absent on a leaf whose op is not `regex`.
	compiled?: RegExp | null,
|};

export type FilterCondition =
	| FilterLeaf
	| {| all: Array<FilterCondition> |}
	| {| any: Array<FilterCondition> |}
	| {| not: FilterCondition |};

export type FilterRule = {|
	id: string,
	enabled: boolean,
	action: FilterAction,
	target?: 'post' | 'comment' | 'both',
	condition: FilterCondition,
	// v1 rules were a flat `field`/`op`/`value` triple on the rule itself. They
	// still parse, and they still export, as a rule whose condition is that one
	// leaf — so these stay readable for a caller holding an old object.
	field?: FilterField,
	op?: FilterOp,
	value?: string,
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

// How a group is repeated, if it is. `?` counts: `(a?){24}` is the textbook
// explosion just as much as `(a+)+` is, and excluding it left a pattern that
// ran for 48 seconds against 26 characters.
// `optional` is the one that is easy to miss: an element that can match nothing
// gives the repeat two ways to consume every position, so `(a?){24}` is 2^24
// paths even though its outer repeat has a ceiling. Measured before this was
// handled: `(a?){26}$` took 48 seconds.
type Repeat = null | 'unbounded' | 'optional' | 'bounded';

function groupRepeat(value: string, index: number): Repeat {
	const ch = value[index];
	if (ch === '+') return 'unbounded';
	if (ch === '*') return 'unbounded'; // unbounded and optional; the stronger one wins
	if (ch === '?') return 'optional';
	if (ch !== '{') return null;
	const brace = (/^\{(\d*)(?:(,)(\d*))?\}/).exec(value.slice(index));
	if (!brace) return null;
	const min = Number(brace[1] || '0');
	// `{n,}` has no ceiling. `{0,m}` and `{0}` can match nothing.
	if (brace[2] && brace[3] === '') return 'unbounded';
	return min === 0 ? 'optional' : 'bounded';
}

// A group's body split on its top-level alternation, with any group prefix
// (`?:`, `?=`, `?<name>` …) removed. Escapes, character classes and nested
// groups are all skipped over so a `|` inside one is not a branch boundary.
function alternatives(body: string): string[] {
	const withoutPrefix = body.replace(/^\?(?::|=|!|<[=!]|<[A-Za-z_$][\w$]*>)/, '');
	const branches = [];
	let depth = 0;
	let inClass = false;
	let start = 0;
	let i = 0;
	while (i < withoutPrefix.length) {
		const at = i;
		const ch = withoutPrefix[at];
		i++;
		if (ch === '\\') { i++; continue; }
		if (inClass) {
			if (ch === ']') inClass = false;
			continue;
		}
		if (ch === '[') { inClass = true; continue; }
		if (ch === '(') { depth++; continue; }
		if (ch === ')') { depth--; continue; }
		if (ch === '|' && depth === 0) {
			branches.push(withoutPrefix.slice(start, at));
			start = i;
		}
	}
	branches.push(withoutPrefix.slice(start));
	return branches;
}

// Whether one piece of a pattern can consume the same text in more than one way,
// which is what makes repeating it backtrack exponentially.
//
// `outerIsUnbounded` is why `(?:\d{1,3}\.){3}` is allowed while `(a{1,10})+` is
// not: a bounded repeat of a bounded inner quantifier has a fixed ceiling, an
// unbounded repeat of one does not.
function isAmbiguous(body: string, outerIsUnbounded: boolean): boolean {
	const branches = alternatives(body);

	if (branches.length > 1) {
		// Alternation is only ambiguous when two branches can match the same
		// input. Distinct literal branches — `(spam|scam|phish)+`, the shape
		// people actually write — cannot, so they stay allowed.
		for (const branch of branches) {
			if (!branch) return true; // `(a|)*` matches empty either way
			if ((/[+*?{(]/).test(branch.replace(/\\./g, ''))) return true;
		}
		for (const [i, branch] of branches.entries()) {
			for (const other of branches.slice(i + 1)) {
				if (branch.startsWith(other) || other.startsWith(branch)) return true;
			}
		}
		return false;
	}

	// The prefix-stripped branch, not the raw body: `(?:re:)?` would otherwise
	// have the `?` of its own `?:` read as a quantifier on `(`.
	const [only] = branches;
	let inClass = false;
	let i = 0;
	while (i < only.length) {
		const at = i;
		const ch = only[at];
		i++;
		if (ch === '\\') { i++; continue; }
		if (inClass) {
			if (ch === ']') inClass = false;
			continue;
		}
		if (ch === '[') { inClass = true; continue; }
		if (ch === '(') {
			// A nested group is only a problem if its own contents are.
			const end = matchingParen(only, at);
			if (end === -1) return true;
			if (isAmbiguous(only.slice(at + 1, end), outerIsUnbounded)) return true;
			i = end + 1;
			continue;
		}
		const repeat = groupRepeat(only, at);
		// An unbounded or optional inner is ambiguous however the outer repeats.
		// A bounded one only matters under an unbounded outer, which is what
		// keeps `(?:\d{1,3}\.){3}` allowed and refuses `(a{1,10})+`.
		if (repeat === 'unbounded' || repeat === 'optional') return true;
		if (repeat === 'bounded' && outerIsUnbounded) return true;
	}
	return false;
}

function matchingParen(value: string, openIndex: number): number {
	let depth = 0;
	let inClass = false;
	let i = openIndex;
	while (i < value.length) {
		const at = i;
		const ch = value[at];
		i++;
		if (ch === '\\') { i++; continue; }
		if (inClass) {
			if (ch === ']') inClass = false;
			continue;
		}
		if (ch === '[') { inClass = true; continue; }
		if (ch === '(') { depth++; continue; }
		if (ch === ')') {
			depth--;
			if (depth === 0) return at;
		}
	}
	return -1;
}

// Heuristic ReDoS guard. JS has no regex-execution timeout, so a user-authored
// pattern like `(a+)+$` can hang the tab when tested against a long body.
// Fail-closed: an unsafe pattern yields no match rather than a hang, and there
// is no filter bypass, because a rejected rule simply never fires.
export function isLikelyCatastrophicRegex(value: mixed): boolean {
	if (typeof value !== 'string') return true;
	// Bound to a const so the string refinement survives the loop below.
	const pattern: string = value;
	if (pattern.length > MAX_REGEX_LENGTH) return true;

	// Match parentheses properly and ask, of every group that is itself
	// repeated, whether its body is ambiguous. The previous version was a single
	// regex looking for a quantifier inside one flat group, which caught `(a+)+`
	// and missed every other textbook shape: measured on Node 24 against 28 a's,
	// `(a|a)*$` ran for 26s, `(a{1,10})+$` for 18.7s, `((a+))+$` for 19.5s,
	// `(?:a|a)*$` for 19s and `(.*a){20}$` for 24.2s, none of them flagged.
	const opens = [];
	let inClass = false;
	let i = 0;
	while (i < pattern.length) {
		const at = i;
		const ch = pattern[at];
		i++;
		if (ch === '\\') { i++; continue; }
		if (inClass) {
			if (ch === ']') inClass = false;
			continue;
		}
		if (ch === '[') { inClass = true; continue; }
		if (ch === '(') { opens.push(at); continue; }
		if (ch !== ')') continue;

		const start = opens.pop();
		// Unbalanced. `new RegExp` would reject it anyway; refusing here keeps
		// this function's answer meaningful on its own.
		if (start === undefined) return true;
		const repeat = groupRepeat(pattern, at + 1);
		if (!repeat) continue;
		if (isAmbiguous(pattern.slice(start + 1, at), repeat === 'unbounded')) return true;
	}

	return opens.length > 0;
}

function compileRegex(value: string): ?RegExp {
	if (isLikelyCatastrophicRegex(value)) return null;
	try { return new RegExp(value, 'i'); } catch (e) { return null; }
}

function fieldValue(rule: FilterLeaf, facts: ThingFacts): mixed {
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

// A nested condition is written by hand in a textarea, and is walked once per
// post. Both of those want a ceiling: a 40-deep tree is a typo, and a rule with
// a thousand leaves is a scroll that stutters. A rule past either limit is
// rejected whole rather than half-applied.
export const MAX_CONDITION_DEPTH = 5;
export const MAX_CONDITION_NODES = 64;

export function isFilterLeaf(condition: mixed): boolean {
	return !!condition && typeof condition === 'object' &&
		typeof (condition: any).field === 'string' &&
		typeof (condition: any).op === 'string' &&
		typeof (condition: any).value === 'string';
}

export function conditionMatches(condition: FilterCondition, facts: ThingFacts): boolean {
	const group = (condition: any);
	// An empty `all` is true and an empty `any` is false, which is what those
	// words mean and what every other rule engine does. Neither is reachable
	// through the parser, which rejects both.
	if (Array.isArray(group.all)) return group.all.every(child => conditionMatches(child, facts));
	if (Array.isArray(group.any)) return group.any.some(child => conditionMatches(child, facts));
	if (group.not) return !conditionMatches(group.not, facts);
	return leafMatches((condition: any), facts);
}

function leafMatches(rule: FilterLeaf, facts: ThingFacts): boolean {
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

export function ruleMatches(rule: FilterRule, facts: ThingFacts): boolean {
	if (!rule.enabled) return false;
	if (rule.target && rule.target !== 'both' && rule.target !== facts.kind) return false;
	// A rule built by hand from the v1 shape has no condition; its own
	// field/op/value are the condition.
	return conditionMatches(rule.condition || ((rule: any): FilterLeaf), facts);
}

export function evaluateRules(rules: FilterRule[], facts: ThingFacts): FilterRule[] {
	return rules.filter(r => ruleMatches(r, facts));
}

export const FILTER_SCHEMA_VERSION = 2;

const FIELDS = ['user', 'subreddit', 'domain', 'keyword', 'flair', 'score', 'commentCount'];
const OPS = ['equals', 'contains', 'regex', 'lt', 'gt'];
const ACTIONS = ['hide', 'dim', 'collapse', 'badge'];
const TARGETS = ['post', 'comment', 'both'];

export type FilterParse = {|
	schemaVersion: number,
	rules: FilterRule[],
	// One line per rule that was thrown away, naming which and why. The editor
	// shows these: a rule that silently disappears reads as a rule that does not
	// work, and every previous version of this parser dropped malformed input
	// without a word.
	errors: string[],
|};

class ConditionError extends Error {}

function readLeaf(raw: any, where: string): FilterLeaf {
	if (!FIELDS.includes(raw.field)) throw new ConditionError(`${where}: "${String(raw.field)}" is not a field`);
	if (!OPS.includes(raw.op)) throw new ConditionError(`${where}: "${String(raw.op)}" is not an operator`);
	if (typeof raw.value !== 'string') throw new ConditionError(`${where}: value must be a string`);
	const leaf: FilterLeaf = { field: raw.field, op: raw.op, value: raw.value };
	// Rejected here rather than at match time, which is the only place the
	// rejection can be reported to the reader and the only place it costs
	// nothing.
	if (raw.op === 'regex') {
		const compiled = compileRegex(raw.value);
		if (!compiled) throw new ConditionError(`${where}: the pattern was rejected as unsafe or invalid`);
		return { ...leaf, compiled };
	}
	return leaf;
}

function readCondition(raw: mixed, where: string, depth: number, budget: {| nodes: number |}): FilterCondition {
	if (depth > MAX_CONDITION_DEPTH) throw new ConditionError(`${where}: nested more than ${MAX_CONDITION_DEPTH} deep`);
	budget.nodes += 1;
	if (budget.nodes > MAX_CONDITION_NODES) throw new ConditionError(`${where}: more than ${MAX_CONDITION_NODES} conditions`);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConditionError(`${where}: a condition is an object`);

	const group = (raw: any);
	for (const key of ['all', 'any']) {
		if (!Object.hasOwn(group, key)) continue;
		if (!Array.isArray(group[key]) || !group[key].length) throw new ConditionError(`${where}: "${key}" needs a non-empty list`);
		const children = group[key].map((child, index) => readCondition(child, `${where}.${key}[${index}]`, depth + 1, budget));
		return key === 'all' ? { all: children } : { any: children };
	}
	if (Object.hasOwn(group, 'not')) return { not: readCondition(group.not, `${where}.not`, depth + 1, budget) };
	return readLeaf(group, where);
}

function readRule(raw: mixed, index: number): FilterRule {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConditionError(`rule ${index}: a rule is an object`);
	const source = (raw: any);
	const where = `rule ${typeof source.id === 'string' ? source.id : index}`;
	if (!ACTIONS.includes(source.action)) throw new ConditionError(`${where}: "${String(source.action)}" is not an action`);
	if (source.target !== undefined && !TARGETS.includes(source.target)) {
		throw new ConditionError(`${where}: "${String(source.target)}" is not a target`);
	}
	// v1 wrote the test on the rule itself. That is exactly a one-leaf
	// condition, so it migrates by being read as one — no semantic change, and
	// nothing to keep in step afterwards.
	const condition = readCondition(
		Object.hasOwn(source, 'condition') ? source.condition : source,
		where,
		1,
		{ nodes: 0 },
	);
	const rule: FilterRule = {
		id: typeof source.id === 'string' ? source.id : `rule-${index}`,
		enabled: source.enabled !== false,
		action: source.action,
		target: source.target,
		condition,
	};
	// A caller holding one of these still sees the v1 triple where there is one.
	return isFilterLeaf(condition) ? { ...rule, ...((condition: any): FilterLeaf) } : rule;
}

// Reads either shape: a bare v1 array, or the v2 envelope. Never throws — a
// rule that cannot be read is dropped and named in `errors`, so one bad rule
// does not take the rest of the set with it.
export function parseFilterRules(raw: mixed): FilterParse {
	const empty = { schemaVersion: FILTER_SCHEMA_VERSION, rules: [], errors: [] };
	if (typeof raw !== 'string' || !raw.trim()) return empty;
	let parsed;
	try { parsed = JSON.parse(raw); } catch (error) {
		return { ...empty, errors: ['The rules are not valid JSON.'] };
	}

	let list;
	if (Array.isArray(parsed)) {
		list = parsed;
	} else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)) {
		const version = parsed.schemaVersion;
		if (version !== undefined && version !== 1 && version !== FILTER_SCHEMA_VERSION) {
			return { ...empty, errors: [`These rules declare schema ${String(version)}; this version reads 1 and ${FILTER_SCHEMA_VERSION}.`] };
		}
		list = parsed.rules;
	} else {
		return { ...empty, errors: ['Rules are a JSON array, or an object with a "rules" array.'] };
	}

	const rules = [];
	const errors = [];
	for (const [index, entry] of list.entries()) {
		try { rules.push(readRule(entry, index)); } catch (error) {
			errors.push(error instanceof ConditionError ? error.message : `rule ${index}: could not be read`);
		}
	}
	return { schemaVersion: FILTER_SCHEMA_VERSION, rules, errors };
}

// The v2 envelope, with the compiled patterns dropped: a `RegExp` does not
// survive `JSON.stringify`, and the pattern it was built from is already there.
export function serializeFilterRules(rules: $ReadOnlyArray<FilterRule>): string {
	return JSON.stringify({
		schemaVersion: FILTER_SCHEMA_VERSION,
		rules: rules.map(rule => ({
			id: rule.id,
			enabled: rule.enabled,
			action: rule.action,
			...(rule.target ? { target: rule.target } : {}),
			condition: exportCondition(rule.condition),
		})),
	}, null, 2);
}

function exportCondition(condition: FilterCondition): mixed {
	const group = (condition: any);
	if (Array.isArray(group.all)) return { all: group.all.map(exportCondition) };
	if (Array.isArray(group.any)) return { any: group.any.map(exportCondition) };
	if (group.not) return { not: exportCondition(group.not) };
	return { field: group.field, op: group.op, value: group.value };
}

// The v1 entry point, kept because three call sites and a browser test use it.
export function parseRulesFromJson(raw: string): FilterRule[] {
	return parseFilterRules(raw).rules;
}
