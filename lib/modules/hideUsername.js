/* @flow */
// RES-Slim: replace the logged-in user's name everywhere it leaks on the page
// (header userbar, .author links across posts/comments) with a stable placeholder
// so screen-shares and over-the-shoulder readers do not see the account name.
// Karma/inbox count are kept so the userbar stays functional.

import { Module } from '../core/module';
import { watchForThings } from '../utils';

export const module: Module<*> = new Module('hideUsername');

module.moduleName = 'Hide your username';
module.category = 'privacyCategory';
module.description = 'Replace your username everywhere it appears on the page with a placeholder. Useful for streaming and screen-shares.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['privacy', 'username', 'doxx', 'streamer', 'stream', 'identity'];

module.options = {
	placeholder: {
		type: 'text',
		value: '[me]',
		title: 'Placeholder text',
		description: 'Text used to replace your username. Defaults to `[me]`.',
	},
	hideKarma: {
		type: 'boolean',
		value: false,
		title: 'Also hide karma totals',
		description: 'Mask your karma counters in the userbar.',
	},
};

const PLACEHOLDER_ATTR = 'rsmHiddenUsername';

let username: string | null = null;

function findUsername(): string | null {
	if (username) return username;
	const link = document.querySelector('#header-bottom-right .user a[href^="/user/"]');
	if (link instanceof HTMLAnchorElement) {
		username = (link.textContent || '').trim() || null;
	}
	return username;
}

function placeholderText(): string {
	const raw = module.options.placeholder.value;
	return (typeof raw === 'string' && raw.trim()) ? raw : '[me]';
}

function maskAnchor(a: HTMLAnchorElement) {
	if (a.dataset[PLACEHOLDER_ATTR] === 'true') return;
	const me = findUsername();
	if (!me) return;
	const text = (a.textContent || '').trim();
	if (text.toLowerCase() !== me.toLowerCase()) return;
	a.textContent = placeholderText();
	a.dataset[PLACEHOLDER_ATTR] = 'true';
}

function maskUserbar() {
	const me = findUsername();
	if (!me) return;
	for (const a of document.querySelectorAll('#header-bottom-right .user a[href^="/user/"]')) {
		if (a instanceof HTMLAnchorElement) maskAnchor(a);
	}
	if (module.options.hideKarma.value) {
		for (const span of document.querySelectorAll('#header-bottom-right .userkarma, #header-bottom-right .karma')) {
			if (span instanceof HTMLElement && span.dataset[PLACEHOLDER_ATTR] !== 'true') {
				span.textContent = '\u2022\u2022\u2022';
				span.dataset[PLACEHOLDER_ATTR] = 'true';
			}
		}
	}
}

function maskAuthorsIn(root: ParentNode = document) {
	for (const a of root.querySelectorAll('a.author')) {
		if (a instanceof HTMLAnchorElement) maskAnchor(a);
	}
}

module.contentStart = () => {
	if (!findUsername()) return; // logged-out user — nothing to hide
	maskUserbar();
	maskAuthorsIn();
	watchForThings(['post', 'comment'], thing => {
		const el = thing.element;
		if (el instanceof Element) maskAuthorsIn(el);
	});
};
