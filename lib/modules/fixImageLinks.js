/* @flow */
// RES-Slim: fix Reddit image links that force the new-reddit viewer.
// Rewrites clicks on links to /media?url=... and other new-reddit image-viewer
// wrappers so they go to the direct i.redd.it URL instead.
// Inspired by AbdurazaaqMohammed/userscripts "Fix Old Reddit Image Links" (Unlicense).

import { Module } from '../core/module';

export const module: Module<*> = new Module('fixImageLinks');

module.moduleName = 'Fix broken image links';
module.category = 'appearanceCategory';
module.description = 'Rewrites i.redd.it / preview.redd.it links so they open the direct image instead of being hijacked by the new-reddit media viewer.';
module.descriptionRaw = true;
module.include = ['r2'];
module.options = {
	rewriteInlineImages: {
		type: 'boolean',
		value: true,
		title: 'Rewrite inline image links',
		description: 'Rewrite post and comment image links to the direct image URL.',
	},
};

function rewrite(url: string): string {
	try {
		const u = new URL(url, location.origin);
		// New-reddit /media?url=... wrapper
		if (u.pathname === '/media' && u.searchParams.has('url')) {
			const inner = u.searchParams.get('url');
			if (inner) return decodeURIComponent(inner);
		}
		// preview.redd.it → i.redd.it direct
		if (u.hostname === 'preview.redd.it') {
			u.hostname = 'i.redd.it';
			u.search = '';
			return u.toString();
		}
		return url;
	} catch {
		return url;
	}
}

function fixAllLinks(root: Document | Element) {
	const anchors = root.querySelectorAll('a[href*="/media?url="], a[href*="preview.redd.it"]');
	for (const a of anchors) {
		const link: HTMLAnchorElement = (a: any);
		const fixed = rewrite(link.href);
		if (fixed !== link.href) link.href = fixed;
	}
}

let observer: MutationObserver | null = null;

module.contentStart = () => {
	if (!module.options.rewriteInlineImages.value) return;
	fixAllLinks(document);
	// The idempotent guard, not disconnect-before-reassign: contentStart is called
	// once per page here, so there is no second observer to orphan. The line that
	// followed this — `if (observer) observer.disconnect();` — sat after an early
	// return on the same condition and could never run.
	if (observer) return;
	observer = new MutationObserver(muts => {
		for (const m of muts) {
			for (const n of m.addedNodes) {
				if (n instanceof Element) fixAllLinks(n);
			}
		}
	});
	observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
};
