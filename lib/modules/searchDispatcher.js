/* @flow */
// RES-Slim: add a small dispatcher selector next to the header search input
// so users can fire the same query at multiple targets (Reddit search, Google
// site:reddit.com, Pushshift PullPush, DuckDuckGo site:reddit.com, etc.)
// without leaving the page. Custom targets can be defined in options.

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('searchDispatcher');

module.moduleName = 'Search dispatcher';
module.category = 'browsingCategory';
module.description = 'Pick where the header search box sends your query: Reddit, Google, DuckDuckGo, or your own custom targets.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['search', 'dispatch', 'google', 'duckduckgo', 'fork', 'multi'];

module.options = {
	customTargets: {
		type: 'text',
		value: '',
		title: 'Custom targets',
		description: 'One per line, format: `Label = https://example.com/?q={q}`. The `{q}` token is replaced with the URL-encoded query.',
	},
};

const SELECTOR_ID = 'RSMSearchDispatcher';

type Target = {| key: string, label: string, title?: string, template: string |};

const DEFAULT_TARGETS: $ReadOnlyArray<Target> = Object.freeze([
	{ key: 'reddit', label: 'Reddit', template: 'https://old.reddit.com/search?q={q}' },
	{ key: 'sub', label: 'Subreddit', title: 'This subreddit', template: '{sub}/search?q={q}&restrict_sr=on' },
	{ key: 'google-site', label: 'Google', title: 'Google · site:reddit.com', template: 'https://www.google.com/search?q=site%3Areddit.com+{q}' },
	{ key: 'ddg-site', label: 'DuckDuckGo', title: 'DuckDuckGo · site:reddit.com', template: 'https://duckduckgo.com/?q=site%3Areddit.com+{q}' },
]);

function parseCustomTargets(): Target[] {
	const raw = module.options.customTargets.value || '';
	return raw.split(/\r?\n/).map((line, i) => {
		const trimmed = line.trim();
		if (!trimmed) return null;
		const eq = trimmed.indexOf('=');
		if (eq < 1) return null;
		const label = trimmed.slice(0, eq).trim();
		const template = trimmed.slice(eq + 1).trim();
		if (!template.includes('{q}')) return null;
		return { key: `custom-${i}`, label, template };
	}).filter(Boolean);
}

function currentSubredditPath(): string | null {
	const m = location.pathname.match(/^\/r\/[^/]+/);
	return m ? m[0] : null;
}

function replaceAllTokens(value: string, token: string, replacement: string): string {
	return value.split(token).join(replacement);
}

function renderUrl(template: string, query: string): string | null {
	const sub = currentSubredditPath();
	const subBase = sub ? `https://old.reddit.com${sub}` : 'https://old.reddit.com';
	const rendered = replaceAllTokens(
		replaceAllTokens(template, '{q}', encodeURIComponent(query)),
		'{sub}',
		subBase,
	);

	try {
		const url = new URL(rendered, location.href);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.href;
	} catch (e) {
		return null;
	}
}

function attach(form: HTMLFormElement) {
	if (form.dataset.rsmDispatcherWired === 'true') return;
	form.dataset.rsmDispatcherWired = 'true';
	const select = document.createElement('select');
	select.id = SELECTOR_ID;
	select.className = 'rsm-search-dispatcher';
	// Its options name destinations - "Reddit", "Google" - so without this a
	// screen reader announces the current one and nothing about what it selects.
	select.setAttribute('aria-label', 'Search destination');
	select.title = 'Where to send this search';
	const targets = [...DEFAULT_TARGETS, ...parseCustomTargets()];
	for (const target of targets) {
		const sub = currentSubredditPath();
		if (target.key === 'sub' && !sub) continue;
		const option = document.createElement('option');
		option.value = target.key;
		option.textContent = target.label;
		option.title = target.title || target.label;
		select.append(option);
	}
	const saved = localStorage.getItem('rsm-search-dispatcher-target');
	if (saved && [...select.options].some(o => o.value === saved)) select.value = saved;
	select.addEventListener('change', () => {
		localStorage.setItem('rsm-search-dispatcher-target', select.value);
	}, false);

	form.append(select);

	form.addEventListener('submit', e => {
		const input = form.querySelector('input[name="q"]');
		if (!(input instanceof HTMLInputElement)) return;
		const query = input.value.trim();
		if (!query) return;
		const target = targets.find(t => t.key === select.value);
		if (!target || target.key === 'reddit') return; // let Reddit's own form handle it
		e.preventDefault();
		const url = renderUrl(target.template, query);
		if (!url) {
			console.warn('searchDispatcher: refused unsafe or invalid search target', target.label);
			return;
		}
		if (target.key === 'sub') {
			location.assign(url);
		} else {
			window.open(url, '_blank', 'noopener,noreferrer');
		}
	}, true);
}

module.contentStart = () => {
	const form = document.querySelector('#search');
	if (form instanceof HTMLFormElement) attach(form);
};
