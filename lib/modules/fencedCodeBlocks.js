/* @flow */
// RES-Slim: old.reddit's markdown has no triple-backtick fenced-code support, so
// ```lang … ``` blocks render as literal text (the #1 upvoted upstream RES ask,
// issue #5223). When a comment/selftext body is entirely one fenced block, this
// module rebuilds it as a real <pre><code>, with optional dependency-free syntax
// highlighting. Conservative by design: only whole-block, plain-text bodies are
// touched, so existing links/lists/formatting are never clobbered.

import { Module } from '../core/module';
import { watchForElements } from '../utils';
import { setTrustedHTML } from '../core/dom/trustedHtml';
import { buildCodeBlockHtml, hasFencePair, parseSingleFence } from '../utils/fencedCode';

export const module: Module<*> = new Module('fencedCodeBlocks');

module.moduleName = 'Fenced code blocks';
module.category = 'commentsCategory';
module.description = 'Render triple-backtick ```fenced``` code blocks as real code blocks on old.reddit, which otherwise shows them as literal text. Optional local syntax highlighting. Only bodies that are entirely one fenced block are rewritten, so other formatting is left untouched.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'wiki', 'profile'];
// On by default. Triple-backtick rendering is the most-requested unshipped
// old.reddit feature in upstream's tracker (issue #5223, open since 2020), and
// old.reddit renders a fenced block as literal text with the backticks visible.
// A differentiator behind a default-off toggle ships invisible.
module.keywords = ['code', 'fence', 'backtick', 'markdown', 'syntax', 'highlight', 'pre'];

module.options = {
	highlight: {
		type: 'boolean',
		// Opt-in separately: rendering the block is a fix, colouring it is a taste.
		value: false,
		title: 'Syntax highlighting',
		description: 'Apply a lightweight, local (no network) token highlighter to rendered code blocks.',
	},
};

const PROCESSED = 'data-rsm-fenced';

// A body is safe to rewrite only when it holds no rich descendants we would
// destroy — links, existing code, lists, media, tables, quotes.
const RICH_SELECTOR = 'a, pre, code, ul, ol, img, table, blockquote, h1, h2, h3, h4, h5, h6';

function isPlainTextBody(md: HTMLElement): boolean {
	return !md.querySelector(RICH_SELECTOR);
}

module.go = () => {
	const highlight = module.options.highlight.value !== false;

	watchForElements(['page'], '.usertext-body > .md', (md: HTMLElement) => {
		if (md.hasAttribute(PROCESSED)) return;
		md.setAttribute(PROCESSED, '1');

		const text = md.textContent || '';
		if (!hasFencePair(text) || !isPlainTextBody(md)) return;

		const parsed = parseSingleFence(text);
		if (!parsed) return;

		setTrustedHTML(md, buildCodeBlockHtml(parsed.lang, parsed.code, highlight));
	});
};
