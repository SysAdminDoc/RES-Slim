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
module.include = ['r2'];
module.keywords = ['filter', 'hide', 'dim', 'rules', 'user', 'subreddit', 'domain', 'keyword'];

module.options = {
	rulesJson: {
		type: 'text',
		value: '[]',
		title: 'Rules (JSON array)',
		description: 'Each rule: { id, enabled, field, op, value, action, target }. See README for the schema.',
	},
};

function readScore(el: Element): number {
	const span = el.querySelector(':scope > .entry .score.unvoted, :scope > .entry .score.likes, :scope > .entry .score.dislikes, :scope > .midcol .score.unvoted');
	if (!span) return 0;
	const text = (span.textContent || '').trim().split(/\s+/)[0];
	const n = parseInt(text, 10);
	return Number.isFinite(n) ? n : 0;
}

function readCommentCount(el: Element): number {
	const v = el.getAttribute('data-comments-count');
	const n = v ? parseInt(v, 10) : 0;
	return Number.isFinite(n) ? n : 0;
}

function postFacts(el: HTMLElement) {
	const flairEl = el.querySelector(':scope > .entry .linkflairlabel');
	return {
		kind: 'post',
		user: el.getAttribute('data-author'),
		subreddit: el.getAttribute('data-subreddit'),
		domain: el.getAttribute('data-domain'),
		title: (el.querySelector(':scope > .entry .title a.title') || {}).textContent || '',
		flair: flairEl ? (flairEl.textContent || '') : '',
		score: readScore(el),
		commentCount: readCommentCount(el),
	};
}

function commentFacts(el: HTMLElement) {
	const flairEl = el.querySelector(':scope > .entry .flair');
	return {
		kind: 'comment',
		user: el.getAttribute('data-author'),
		subreddit: el.getAttribute('data-subreddit'),
		body: (el.querySelector(':scope > .entry .usertext-body') || {}).textContent || '',
		flair: flairEl ? (flairEl.textContent || '') : '',
		score: readScore(el),
	};
}

function applyMatches(el: HTMLElement, matches) {
	if (!matches.length) return;
	let hidden = false;
	for (const rule of matches) {
		el.dataset.rsmFilterHit = (el.dataset.rsmFilterHit || '') + ` ${rule.id}`;
		switch (rule.action) {
			case 'hide':
				el.style.display = 'none';
				hidden = true;
				break;
			case 'dim':
				el.style.opacity = '0.45';
				break;
			case 'collapse': {
				const expand = el.querySelector(':scope > .entry .expand');
				if (expand instanceof HTMLElement && !el.classList.contains('collapsed')) expand.click();
				break;
			}
			case 'badge': {
				if (!el.querySelector('.rsm-filter-badge')) {
					const badge = document.createElement('span');
					badge.className = 'rsm-filter-badge';
					badge.textContent = rule.value || rule.field;
					badge.title = `Filter: ${rule.field} ${rule.op} ${rule.value}`;
					const entry = el.querySelector(':scope > .entry .tagline');
					if (entry) entry.append(badge);
				}
				break;
			}
		}
		if (hidden) break;
	}
}

let cachedRules = [];

function refreshRules() {
	cachedRules = parseRulesFromJson(module.options.rulesJson.value || '[]');
}

module.contentStart = () => {
	refreshRules();
	if (module.options.rulesJson.onChange) {
		// no-op — schema doesn't ship onChange yet, rule changes apply on next page load
	}
	watchForThings(['post'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		const matches = evaluateRules(cachedRules, postFacts(el));
		applyMatches(el, matches);
	});
	watchForThings(['comment'], (thing: Thing) => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		const matches = evaluateRules(cachedRules, commentFacts(el));
		applyMatches(el, matches);
	});
};
