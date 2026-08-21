/* @flow */
// RES-Slim: heuristic LLM/bot comment flagger. Runs a set of simple rules over each
// comment body and username and adds a color-coded outline plus a tooltip describing
// which rules matched. No backend, no ML, no external calls.
// Inspired by RootThePlanet/Reddit_AI_BotBuster / "Redd-Eye" (MIT).

import { Module } from '../core/module';
import { Thing, isPageType, watchForThings } from '../utils';

export const module: Module<{ [string]: any }> = new Module('reddEye');

module.moduleName = 'Redd-Eye (bot/LLM flagger)';
module.category = 'commentsCategory';
module.description = 'Heuristic flagging of comments that look like they were written by an LLM or low-effort bot. Color-codes the outline and shows which rules matched on hover.';
module.descriptionRaw = true;
module.include = ['comments', 'commentsLinklist'];
module.options = {
	threshold: {
		type: 'enum',
		value: 'medium',
		values: [
			{ name: 'Low (any single rule)', value: 'low' },
			{ name: 'Medium (two rules)', value: 'medium' },
			{ name: 'High (three rules)', value: 'high' },
		],
		title: 'Confidence threshold',
		description: 'How many rules must match before a comment is flagged.',
	},
	hideFlagged: {
		type: 'boolean',
		value: false,
		title: 'Collapse flagged comments',
		description: 'Collapse flagged comments instead of just outlining them.',
	},
};

// A single rule: test returns true if the text/username looks suspicious,
// and a short name that shows in the tooltip.
type Rule = {| name: string, weight: number, test: (body: string, username: string) => boolean |};

const RULES: Rule[] = [
	{
		name: 'LLM boilerplate phrase',
		weight: 2,
		test: body => /\b(certainly!|as an ai|i'm sorry, but|i hope this helps|in summary|it's important to note|feel free to ask|absolutely!|great question)/i.test(body),
	},
	{
		name: 'Numbered-list structure',
		weight: 1,
		// Three or more numbered list items in a row — characteristic of LLM answers.
		test: body => /(\n|\. )\s*1[\.\)] .+(\n|\. )\s*2[\.\)] .+(\n|\. )\s*3[\.\)]/.test(body),
	},
	{
		name: 'Heavy emoji use',
		weight: 1,
		test: body => {

			const emojis = body.match(/\p{Extended_Pictographic}/gu) || [];
			return emojis.length >= 4;
		},
	},
	{
		name: 'Random-adjective username',
		weight: 1,
		test: (_body, username) => /^[A-Z][a-z]+(?:_|-)?[A-Z][a-z]+[_-]?\d{3,}$/.test(username),
	},
	{
		name: 'All-lowercase username + digits',
		weight: 1,
		test: (_body, username) => /^[a-z]+\d{4,}$/.test(username),
	},
	{
		name: 'Wikipedia-style hedging',
		weight: 1,
		test: body => /\b(it is generally|it's worth noting|it should be noted|it is important to|broadly speaking|on the other hand,)/i.test(body),
	},
	{
		name: 'Overlong for simple question',
		weight: 1,
		test: body => body.length > 1500 && /\n\n/.test(body),
	},
];

function thresholdValue(): number {
	switch (module.options.threshold.value) {
		case 'low': return 1;
		case 'high': return 4;
		default: return 2;
	}
}

function evaluate(thing: Thing) {
	const md = thing.entry.querySelector('.usertext-body .md');
	if (!(md instanceof HTMLElement)) return;
	const body = md.textContent || '';
	if (!body.trim()) return;
	const authorEl = thing.entry.querySelector('a.author');
	const username = authorEl ? (authorEl.textContent || '').trim() : '';

	const matched: Rule[] = [];
	let score = 0;
	for (const rule of RULES) {
		if (rule.test(body, username)) {
			matched.push(rule);
			score += rule.weight;
		}
	}

	if (score >= thresholdValue()) {
		const entry = thing.entry;
		entry.style.outline = '2px solid #e67e22';
		entry.style.outlineOffset = '-2px';
		entry.title = `Redd-Eye flagged: ${matched.map(r => r.name).join(', ')}`;
		if (module.options.hideFlagged.value && !thing.element.classList.contains('collapsed')) {
			const expandToggle: ?HTMLElement = (thing.element.querySelector(':scope > .entry .tagline > .expand'): any);
			if (expandToggle) expandToggle.click();
			else thing.element.classList.add('collapsed');
		}
	}
}

module.contentStart = () => {
	if (!isPageType('comments', 'commentsLinklist')) return;
	watchForThings(['comment'], evaluate);
};
