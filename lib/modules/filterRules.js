/* @flow */
// RES-Slim: a single-textarea filter builder. Users paste JSON describing
// rules; each rule has a field, op, value, and action (hide/dim/collapse/
// badge). Rules evaluate against .thing.link and .thing.comment via
// watchForThings (added nodes only). Mirrors the depth of upstream RES
// filteReddit's case system but with a flat, importable schema.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import { evaluateRules, parseRulesFromJson } from '../utils/filterRules';

export const module: Module<*> = new Module('filterRules');

module.moduleName = 'Filter builder';
module.category = 'browsingCategory';
module.description = 'Hide, dim, collapse, or badge posts/comments by user, subreddit, domain, keyword, flair, score, or comment count. JSON-backed.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.keywords = ['filter', 'hide', 'dim', 'rules', 'user', 'subreddit', 'domain', 'keyword'];

// Ships with one default rule: hide "I built ..." self-promo submission posts.
// Remove or disable it from the settings console like any other rule.
const DEFAULT_RULES_JSON = '[{"id":"i-built","field":"keyword","op":"regex","value":"^I\\\\s+built\\\\b","action":"hide","target":"post"}]';

module.options = {
	rulesJson: {
		type: 'text',
		value: DEFAULT_RULES_JSON,
		title: 'Rules (JSON array)',
		description: 'Each rule: { id, enabled, field, op, value, action, target }. See README for the schema.',
	},
};

function postFacts(thing: Thing) {
	return {
		kind: 'post',
		user: thing.getAuthor(),
		subreddit: thing.getSubreddit(),
		domain: thing.getPostDomain(),
		title: thing.getTitle(),
		flair: thing.getPostFlairText(),
		score: thing.getScore() || 0,
		commentCount: thing.getCommentCount() || 0,
	};
}

function commentFacts(thing: Thing) {
	const body = thing.getTextBody();
	return {
		kind: 'comment',
		user: thing.getAuthor(),
		subreddit: thing.getSubreddit(),
		body: body && body.textContent || '',
		flair: thing.getUserFlairText(),
		score: thing.getScore() || 0,
	};
}

function appendHit(el: HTMLElement, ruleId: string): void {
	const prior = el.dataset.rsmFilterHit || '';
	const seen = prior ? prior.split(' ').filter(Boolean) : [];
	if (seen.includes(ruleId)) return;
	seen.push(ruleId);
	el.dataset.rsmFilterHit = seen.join(' ');
}

function applyMatches(thing: Thing, kind: 'post' | 'comment', matches) {
	if (!matches.length) return;
	const el = thing.element;
	for (const rule of matches) {
		appendHit(el, String(rule.id || rule.field));
		switch (rule.action) {
			case 'hide':
				el.style.display = 'none';
				return; // hide is terminal — no further actions matter
			case 'dim':
				el.style.opacity = '0.45';
				break;
			case 'collapse': {
				// collapse only makes sense for comments — posts don't have a
				// native collapse affordance on old.reddit. Treat as dim for posts
				// so the rule isn't silently dropped.
				if (kind === 'post') {
					el.style.opacity = '0.45';
					break;
				}
				thing.setCommentCollapse(true, 'filterRules');
				break;
			}
			case 'badge': {
				if (!el.querySelector('.rsm-filter-badge')) {
					const badge = document.createElement('span');
					badge.className = 'rsm-filter-badge';
					badge.textContent = rule.value || rule.field;
					badge.title = `Filter: ${rule.field} ${rule.op} ${rule.value}`;
					const entry = thing.getTaglineElement();
					if (entry) entry.append(badge);
				}
				break;
			}
		}
	}
}

let cachedRules = [];

function refreshRules() {
	cachedRules = parseRulesFromJson(module.options.rulesJson.value || '[]');
}

module.contentStart = () => {
	refreshRules();
	watchForThings(['post'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		const matches = evaluateRules(cachedRules, postFacts(thing));
		applyMatches(thing, 'post', matches);
	});
	watchForThings(['comment'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		const matches = evaluateRules(cachedRules, commentFacts(thing));
		applyMatches(thing, 'comment', matches);
	});
};
