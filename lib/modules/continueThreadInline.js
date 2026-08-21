/* @flow */
// RES-Slim: replace "continue this thread →" links with an inline expander
// that fetches the next slice of comments and splices them into the current
// thread. Mirrors the user-script "Reddit Load Continue thread inline" but
// rewritten to operate on the existing watchForThings pipeline.
//
// Reverts cleanly: toggling the module off and reloading restores the link;
// destroy() at runtime restores any link that has not yet been clicked.

import { Module } from '../core/module';
import { watchForThings } from '../utils';

export const module: Module<{ [string]: any }> = new Module('continueThreadInline');

module.moduleName = 'Inline "continue thread" loader';
module.category = 'commentsCategory';
module.description = 'Replace "continue this thread" links with an inline fetch that splices the next slice of comments into the current page.';
module.descriptionRaw = true;
module.include = ['comments'];
module.keywords = ['comment', 'continue', 'thread', 'depth', 'load'];

module.options = {};

const PROCESSED_ATTR = 'rsmContinueInlined';

const LOADING_TEXT = 'loading…';
const FAILED_TEXT = 'failed';

function isContinueThread(a: HTMLAnchorElement): boolean {
	const href = a.getAttribute('href') || '';
	if (!href.startsWith('/r/') || !href.includes('/comments/')) return false;
	// Old Reddit puts the link inside a small `<span class="deepthread">` block;
	// the link text matches one of several phrasings depending on locale.
	const text = (a.textContent || '').trim().toLowerCase();
	if (text.startsWith('continue')) return true;
	return a.closest('.deepthread, .nestedlisting > .morechildren') instanceof HTMLElement;
}

// The one credentialed fetch in the tree built from page markup. Every other
// fetch here sends `credentials: 'omit'`; this one cannot, because the
// destination is a logged-in comment page. So the URL has to be checked instead,
// and checked against `a.href` — the resolved absolute URL — rather than the
// attribute, since `//evil.example` and a `javascript:` href both read as
// harmless strings until the browser resolves them.
//
// `background-url-guard-contract` does not cover this: it guards the background
// proxy, which this path does not go through.
export function isSafeThreadUrl(rawUrl: mixed): boolean {
	if (typeof rawUrl !== 'string' || !rawUrl) return false;
	let url;
	try {
		url = new URL(rawUrl, location.href);
	} catch (e) {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	if (url.origin !== location.origin) return false;
	return /^\/r\/[\w.-]+\/comments\/[\w]+(\/|$)/.test(url.pathname);
}

async function loadInline(a: HTMLAnchorElement) {
	if (a.dataset[PROCESSED_ATTR] === 'true') return;
	a.dataset[PROCESSED_ATTR] = 'true';

	const originalText = a.textContent;
	a.textContent = LOADING_TEXT;
	a.classList.add('rsm-continue-inline-loading');

	try {
		if (!isSafeThreadUrl(a.href)) throw new Error('refusing to send credentials to a non-reddit thread URL');
		const response = await fetch(a.href, { credentials: 'include', headers: { Accept: 'text/html' } });
		if (!response.ok) throw new Error(`status ${response.status}`);
		const html = await response.text();
		const doc = new DOMParser().parseFromString(html, 'text/html');
		// The comment subtree on the destination page lives in the same nested
		// listing structure — grab the first one.
		const root = doc.querySelector('.commentarea .sitetable.nestedlisting');
		if (!(root instanceof HTMLElement)) throw new Error('thread markup missing');

		const host = a.closest('.deepthread, .morechildren') || a.parentElement;
		if (!(host instanceof HTMLElement)) throw new Error('no host element');

		// Move children rather than the wrapper so existing parent selectors
		// (e.g. RES infiniteScroll) keep matching.
		const fragment = document.createDocumentFragment();
		for (const child of Array.from(root.children)) fragment.append(child);
		host.replaceWith(fragment);
	} catch (e) {
		a.dataset[PROCESSED_ATTR] = '';
		a.classList.remove('rsm-continue-inline-loading');
		a.classList.add('rsm-continue-inline-failed');
		a.textContent = `${FAILED_TEXT} \u2014 ${originalText || ''}`.trim();
	}
}

function attachHandlers(root: ParentNode = document) {
	for (const a of root.querySelectorAll('a[href*="/comments/"]')) {
		if (!(a instanceof HTMLAnchorElement)) continue;
		if (!isContinueThread(a)) continue;
		if (a.dataset[PROCESSED_ATTR] !== undefined) continue;
		a.dataset[PROCESSED_ATTR] = 'false';
		a.addEventListener('click', e => {
			// Honour user modifier keys for new tabs / windows.
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e: any).button === 1) return;
			e.preventDefault();
			loadInline(a).catch(() => {});
		}, true);
	}
}

module.contentStart = () => {
	attachHandlers();
	watchForThings(['comment'], thing => {
		const el = thing.element;
		if (el instanceof Element) attachHandlers(el);
	});
};
