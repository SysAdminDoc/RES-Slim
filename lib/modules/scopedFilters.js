/* @flow */
// RES-Slim: two filter capabilities that didn't fit cleanly into the v0.10.0
// filterRules schema:
//   1) Per-sub muting — mute a user only when browsing a specific sub.
//   2) URL substring block — hide any post or comment whose URL contains a
//      configured fragment. Useful for affiliate-spam patterns and other
//      domain-with-path patterns the flat domain filter cannot express.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';
import {
	muteApplies,
	parsePerSubMutes,
	parseUrlSubstrings,
	urlMatchesAny,
} from '../utils/scopedFilters';
import type { PerSubMute } from '../utils/scopedFilters';

export const module: Module<{ [string]: any }> = new Module('scopedFilters');

module.moduleName = 'Scoped filters (sub mute + URL substring)';
module.category = 'browsingCategory';
module.description = 'Two scoped filters that complement filterRules: per-sub user muting (mute X only in sub Y) and URL-substring blocking (hide affiliate/spam URLs by substring match). Both default off.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['mute', 'sub', 'url', 'substring', 'affiliate', 'spam', 'filter'];

module.options = {
	perSubMutes: {
		type: 'text',
		value: '',
		title: 'Per-sub mutes',
		description: 'List of `user|sub` pairs separated by commas or newlines. The user is hidden only when browsing that sub. Use `*` for the sub to mute everywhere. Example: `spammer|news, badbot|pics`.',
	},
	urlSubstrings: {
		type: 'text',
		value: '',
		title: 'URL substring blocks',
		description: 'Comma- or newline-separated list of substrings. Any post URL, post domain, or comment-body URL containing a substring is hidden. Case-insensitive. Example: `affiliate.example.com, ?ref=spammer`.',
	},
	hideCompletely: {
		type: 'boolean',
		value: true,
		title: 'Hide completely',
		description: 'When matched, set display:none on the entire .thing. Disable to only dim the row.',
	},
};

let mutes: PerSubMute[] = [];
let urlSubs: string[] = [];

function currentSub(): string {
	const m = /^\/r\/([^/]+)/i.exec(location.pathname || '');
	return m ? m[1].toLowerCase() : '';
}

function applyHide(el: HTMLElement, reason: string): void {
	if (module.options.hideCompletely.value === false) {
		el.style.opacity = '0.4';
	} else {
		el.style.display = 'none';
	}
	el.dataset.rsmScopedFilter = reason;
}

function postUrls(el: HTMLElement): string[] {
	const out: string[] = [];
	const dataUrl = el.getAttribute('data-url');
	if (dataUrl) out.push(dataUrl);
	const domain = el.getAttribute('data-domain');
	if (domain) out.push(domain);
	const title = el.querySelector(':scope > .entry .title a.title');
	if (title instanceof HTMLAnchorElement) out.push(title.href);
	return out;
}

function commentUrls(el: HTMLElement): string[] {
	const out: string[] = [];
	const anchors = el.querySelectorAll(':scope > .entry .usertext-body a[href]');
	for (let i = 0; i < anchors.length; i++) {
		const a = anchors[i];
		if (a instanceof HTMLAnchorElement && a.href) out.push(a.href);
	}
	return out;
}

function processPost(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const author = el.getAttribute('data-author') || '';
	if (mutes.length && muteApplies(mutes, currentSub(), author)) {
		applyHide(el, 'mute');
		return;
	}
	if (urlSubs.length && urlMatchesAny(postUrls(el), urlSubs)) {
		applyHide(el, 'url');
	}
}

function processComment(thing: Thing): void {
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const author = el.getAttribute('data-author') || '';
	if (mutes.length && muteApplies(mutes, currentSub(), author)) {
		applyHide(el, 'mute');
		return;
	}
	if (urlSubs.length && urlMatchesAny(commentUrls(el), urlSubs)) {
		applyHide(el, 'url');
	}
}

module.contentStart = () => {
	mutes = parsePerSubMutes(module.options.perSubMutes.value);
	urlSubs = parseUrlSubstrings(module.options.urlSubstrings.value);
	if (!mutes.length && !urlSubs.length) return;
	watchForThings(['post'], processPost);
	watchForThings(['comment'], processComment);
};
