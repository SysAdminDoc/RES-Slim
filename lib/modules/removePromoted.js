/* @flow */
// RES-Slim: remove promoted (sponsored) posts from feed surfaces on old Reddit.
// Matches both legacy `.thing.link.promoted` markup and the `data-promoted="true"`
// attribute used on newer mirrored markup. Defaults on; count is exposed via an
// unobtrusive header badge so users can verify it's working.

import { Module } from '../core/module';
import { watchForThings } from '../utils';

export const module: Module<*> = new Module('removePromoted');

module.moduleName = 'Remove promoted posts';
module.category = 'browsingCategory';
module.description = 'Hide sponsored posts on feed pages. Targets `.thing.link.promoted` and `[data-promoted=true]`.';
module.descriptionRaw = true;
module.include = ['r2'];
module.alwaysEnabled = true;
module.keywords = ['promoted', 'sponsored', 'ads', 'adblock', 'promo'];

module.options = {
	showCount: {
		type: 'boolean',
		value: true,
		title: 'Show removed count',
		description: 'Show a small badge in the page header with the number of promoted posts hidden this page-load.',
	},
};

// Reddit has used all four hooks on old-reddit feed records. The data-adserver
// attributes are especially useful when a skin strips the presentation class.
const PROMOTED_SELECTOR = [
	'.thing.link.promoted',
	'.thing.link.promotedlink',
	'.thing.link[data-promoted="true"]',
	'.thing.link[data-adserver-imp-pixel]',
	'.thing.link[data-adserver-click-url]',
].join(', ');
const BADGE_ID = 'RSMPromotedHiddenBadge';

let removedCount = 0;
let badgeNode: ?HTMLElement = null;

function ensureBadge(): ?HTMLElement {
	if (!module.options.showCount.value) return null;
	if (badgeNode && document.body.contains(badgeNode)) return badgeNode;
	const host = document.getElementById('header-bottom-right') || document.querySelector('#header .tabmenu');
	if (!(host instanceof HTMLElement)) return null;
	const badge = document.createElement('span');
	badge.id = BADGE_ID;
	badge.className = 'rsm-promoted-hidden-badge';
	badge.setAttribute('title', 'Promoted posts hidden this page-load');
	badge.dataset.rsmPromotedBadge = 'true';
	host.append(badge);
	badgeNode = badge;
	return badge;
}

function refreshBadge() {
	const badge = ensureBadge();
	if (!badge) return;
	badge.textContent = removedCount === 0 ? '' : String(removedCount);
	badge.hidden = removedCount === 0;
}

function hidePromoted(el: HTMLElement) {
	if (el.dataset.rsmPromotedHidden === 'true') return;
	el.dataset.rsmPromotedHidden = 'true';
	el.style.display = 'none';
	removedCount += 1;
	refreshBadge();
}

function isPromoted(el: HTMLElement): boolean {
	if (el.matches(PROMOTED_SELECTOR)) return true;
	return Boolean(
		el.querySelector('.promoted-tag, [data-promoted="true"]') ||
		el.querySelector('a[href*="//alb.reddit.com/"]'),
	);
}

function sweepDocument() {
	for (const el of document.querySelectorAll(PROMOTED_SELECTOR)) {
		if (el instanceof HTMLElement) hidePromoted(el);
	}
}

module.contentStart = () => {
	sweepDocument();
	// New posts can stream in from infiniteScroll or async loads.
	watchForThings(['post'], thing => {
		const el = thing.element;
		if (!(el instanceof HTMLElement)) return;
		if (isPromoted(el)) hidePromoted(el);
	});
};
