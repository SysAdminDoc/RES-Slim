/* @flow */
// RES-Slim: keep reddit from machine-translating the page.
//
// Concept from "Prevent Reddit Auto-Translate" (Greasy Fork 537246). Parameter
// handling lives in lib/utils/autoTranslate.js.

import { Module } from '../core/module';
import { watchForElements } from '../utils';
import { hasTranslationParam, stripTranslationParams } from '../utils/autoTranslate';

export const module: Module<{ [string]: any }> = new Module('preventAutoTranslate');

module.moduleName = 'Prevent auto-translation';
module.category = 'browsingCategory';
module.description = 'Removes the <code>?tl=</code> parameter reddit adds to serve you a machine translation of a thread. Cleans the current URL and every reddit link on the page, so navigating onward stays untranslated.';
module.descriptionRaw = true;
module.include = ['comments', 'linklist', 'commentsLinklist', 'profile', 'search'];
module.keywords = ['translate', 'translation', 'language', 'tl'];

module.options = {
	reloadIfTranslated: {
		type: 'boolean',
		value: false,
		title: 'Reload when the page arrived translated',
		description: 'Off by default: reloading costs a round trip and rewriting the address bar is enough for onward navigation. Turn it on if you want the current page in its original language too.',
	},
};

const ATTR = 'data-rsm-untranslated';

function cleanCurrentUrl() {
	const cleaned = stripTranslationParams(location.href);
	if (!cleaned) return;

	if (module.options.reloadIfTranslated.value) {
		location.replace(cleaned);
		return;
	}

	// replaceState rather than pushState: a translated URL is not a place the
	// user chose to be, so it should not occupy a back-button entry.
	try {
		history.replaceState(history.state, '', cleaned);
	} catch (e) {
		// Some pages are served with an opaque origin where replaceState throws.
		// The link cleaning below still applies, so this is not fatal.
	}
}

function cleanLink(anchor: HTMLAnchorElement) {
	if (anchor.hasAttribute(ATTR)) return;
	const raw = anchor.getAttribute('href');
	if (typeof raw !== 'string' || !hasTranslationParam(raw)) return;
	const cleaned = stripTranslationParams(raw);
	if (!cleaned) return;
	anchor.setAttribute(ATTR, '1');
	anchor.setAttribute('href', cleaned);
}

module.contentStart = () => {
	cleanCurrentUrl();

	for (const anchor of document.querySelectorAll('a[href]')) {
		if (anchor instanceof HTMLAnchorElement) cleanLink(anchor);
	}
	watchForElements(['page'], 'a[href]', (anchor: HTMLElement) => {
		if (anchor instanceof HTMLAnchorElement) cleanLink(anchor);
	});
};
