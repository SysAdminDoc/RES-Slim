/* @flow */
// RES-Slim: a single-textarea filter builder. Users paste JSON describing
// rules; each rule has a field, op, value, and action (hide/dim/collapse/
// badge). Rules evaluate against .thing.link and .thing.comment via
// watchForThings (added nodes only). Mirrors the depth of upstream RES
// filteReddit's case system but with a flat, importable schema.

import { Module } from '../core/module';
import * as Options from '../core/options';
import { context, getOptionsURL } from '../environment';
import { Thing, watchForThings } from '../utils';
import { evaluateRules, parseFilterRules } from '../utils/filterRules';
import { describePreview, requestFilterPreview } from '../utils/filterPreview';
import { hideAndSilence } from '../utils/mediaSilence';

export const module: Module<{ [string]: any }> = new Module('filterRules');

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
		title: 'Rules',
		description: 'A JSON array of rules, or { "schemaVersion": 2, "rules": [...] }. Each rule has an id, an action (hide, dim, collapse, badge), an optional target, and a condition. A condition is either a single test, such as { "field": "flair", "op": "equals", "value": "OC" }, or a group: { "all": [...] }, { "any": [...] }, { "not": ... }. The old flat form still works. See the README for the fields and operators.',
	},
	previewActions: {
		type: 'button',
		title: 'Try these rules on the page behind this console',
		description: 'Counts what the rules in the box would match right now, without saving them. Show matches outlines them on the page; it changes nothing and is undone by Hide matches or by reloading.',
		values: [
			{ text: 'Count matches', callback: countMatchesOnPage },
			{ text: 'Show matches', callback: revealMatchesOnPage },
			{ text: 'Hide matches', callback: clearRevealOnPage },
		],
	},
};

// --- the settings-page half -------------------------------------------------
//
// These three run in the options document, not on the Reddit page. They ask the
// page through `settingsNavigation`, which is the only thing that knows the two
// windows are related.

function liveRulesJson(): string {
	const control = document.getElementById('filterRules-rulesJson');
	if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) return control.value;
	const staged = Options.stage.get(module.moduleID);
	return String((staged && staged.rulesJson ? staged.rulesJson.value : module.options.rulesJson.value) || '');
}

function setPreviewStatus(message: string, state?: 'error' | 'success'): void {
	const group = document.getElementById('filterRules-previewActions');
	if (!(group instanceof HTMLElement) || !group.parentElement) return;
	let status = group.parentElement.querySelector('.rsm-filterRules-preview-status');
	if (!(status instanceof HTMLElement)) {
		status = document.createElement('p');
		status.className = 'rsm-filterRules-preview-status';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		group.after(status);
	}
	status.textContent = message;
	if (state) status.dataset.state = state;
	else delete status.dataset.state;
}

async function askThePage(reveal: boolean): Promise<void> {
	const rulesJson = liveRulesJson();
	// Parsed here as well as on the page, so a set that cannot be read is
	// reported without a round trip and without the page touching anything.
	const parsed = parseFilterRules(rulesJson);
	if (parsed.errors.length) {
		setPreviewStatus(parsed.errors.join(' '), 'error');
		return;
	}
	// The page behind the console is Reddit, not this extension: a reply posted
	// to our own origin would never be delivered, and never rejected either.
	const reply = await requestFilterPreview(rulesJson, reveal, context.origin);
	if (!reply) {
		setPreviewStatus('There is no Reddit page behind this console to try the rules on. Open the settings from a Reddit tab.', 'error');
		return;
	}
	setPreviewStatus(describePreview(reply), reply.matched ? 'success' : undefined);
}

function countMatchesOnPage(): Promise<void> { return askThePage(false); }
function revealMatchesOnPage(): Promise<void> { return askThePage(true); }

async function clearRevealOnPage(): Promise<void> {
	const reply = await requestFilterPreview('[]', true, context.origin);
	setPreviewStatus(reply ? 'Outlines cleared.' : 'There is no Reddit page behind this console.', reply ? undefined : 'error');
}

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
				// Hiding a post does not stop what it was playing, so a filtered
				// video kept its audio running with nothing on screen to pause it.
				hideAndSilence(el);
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
					badge.textContent = rule.value || rule.id;
					badge.title = rule.field ?
						`Filter: ${rule.field} ${String(rule.op)} ${String(rule.value)}` :
						`Filter: ${rule.id}`;
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
	const parsed = parseFilterRules(module.options.rulesJson.value || '[]');
	cachedRules = parsed.rules;
	// A rule that cannot be read is dropped, and a dropped rule that says nothing
	// looks exactly like a rule that does not work.
	for (const problem of parsed.errors) console.warn(`RES-Slim filterRules: ${problem}`);
}

const PREVIEW_ATTRIBUTE = 'data-rsm-filter-preview';

function clearPreviewMarks(): void {
	for (const marked of document.querySelectorAll(`[${PREVIEW_ATTRIBUTE}]`)) {
		if (marked instanceof HTMLElement) marked.removeAttribute(PREVIEW_ATTRIBUTE);
	}
}

// What the rules in the editor would do to this page, without doing any of it.
// Nothing here writes a setting, hides a thing, or touches `cachedRules`: the
// only change to the document is an attribute the stylesheet outlines, and
// `clearPreviewMarks` takes even that back.
function previewRules(rulesJson: mixed, reveal: boolean): {|
	scanned: number,
	matched: number,
	counts: { [string]: number },
	errors: string[],
|} {
	const parsed = parseFilterRules(rulesJson);
	const counts = {};
	for (const rule of parsed.rules) counts[rule.id] = 0;
	clearPreviewMarks();

	let scanned = 0;
	let matched = 0;
	for (const element of document.querySelectorAll(Thing.thingSelector)) {
		if (!(element instanceof HTMLElement)) continue;
		const thing = Thing.from(element);
		if (!thing) continue;
		scanned += 1;
		const kind = thing.isPost() ? 'post' : 'comment';
		const matches = evaluateRules(parsed.rules, kind === 'post' ? postFacts(thing) : commentFacts(thing));
		if (!matches.length) continue;
		matched += 1;
		for (const rule of matches) counts[rule.id] += 1;
		if (reveal) element.setAttribute(PREVIEW_ATTRIBUTE, matches.map(rule => rule.id).join(' '));
	}
	return { scanned, matched, counts, errors: parsed.errors };
}

// The console asks from its iframe; this answers from the page. The listener
// lives here rather than in `settingsNavigation` because the options page loads
// that module for real, and importing the filter runtime from it put every
// line of this file into the settings bundle.
function onPreviewRequest({ origin, data, source }: any) {
	if (origin !== getOptionsURL().origin) return;
	const request = data && data.requestFilterPreview;
	if (!request || !source) return;
	try {
		source.postMessage({ filterPreview: previewRules(request.rulesJson, !!request.reveal) }, origin);
	} catch (error) {
		// A console that closed between asking and being answered is not worth
		// reporting; the request times out on its side.
		console.warn('RES-Slim: could not answer the filter preview request', error);
	}
}

module.contentStart = () => {
	refreshRules();
	window.addEventListener('message', onPreviewRequest);
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
