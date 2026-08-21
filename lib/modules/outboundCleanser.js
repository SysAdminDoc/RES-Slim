/* @flow */
// RES-Slim: strip Reddit outbound-tracker wrappers + common tracking query parameters
// from anchor hrefs as the user hovers, copies, and clicks. Operates on the DOM,
// never makes network calls of its own. Schema-backed (`outboundCleanser`).

import { Module } from '../core/module';
import { cleanseUrl } from '../utils/outboundCleanser';

export const module: Module<{ [string]: any }> = new Module('outboundCleanser');

const PROCESSED_ATTR = 'rsmOutboundCleansed';

function cleanseAnchor(a: HTMLAnchorElement) {
	if (a.dataset[PROCESSED_ATTR] === 'true') return;
	const next = cleanseUrl(a.href, window.location.href);
	if (next !== null) {
		a.href = next;
		a.removeAttribute('data-href-url');
		a.removeAttribute('data-event-action');
	}
	a.dataset[PROCESSED_ATTR] = 'true';
}

function sweepAllAnchors(root: ParentNode = document) {
	for (const a of root.querySelectorAll('a[href]')) {
		if (a instanceof HTMLAnchorElement) cleanseAnchor(a);
	}
}

function bubbleHandler(e: Event) {
	if (!(e.target instanceof Element)) return;
	const a = e.target.closest('a[href]');
	if (a instanceof HTMLAnchorElement) cleanseAnchor(a);
}

let observer: MutationObserver | null = null;

module.moduleName = 'Outbound link cleanser';
module.category = 'privacyCategory';
module.description = 'Strip Reddit\'s `out.reddit.com` tracker wrappers and common UTM/ref parameters from links on hover, copy, and click.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.keywords = ['privacy', 'tracking', 'outbound', 'utm', 'tracker', 'redirect'];

module.options = {
	stripUtm: {
		type: 'boolean',
		value: true,
		title: 'Strip UTM / ref parameters',
		description: 'Remove `utm_*`, `ref_*`, and share-id query parameters from outbound links.',
	},
};

module.contentStart = () => {
	sweepAllAnchors();
	document.addEventListener('mouseover', bubbleHandler, true);
	document.addEventListener('focusin', bubbleHandler, true);
	document.addEventListener('contextmenu', bubbleHandler, true);
	document.addEventListener('copy', bubbleHandler, true);
	document.addEventListener('click', bubbleHandler, true);

	// Declared `| null` but never disconnected: a second call orphaned the first
	// observer while leaving it running.
	if (observer) observer.disconnect();
	observer = new MutationObserver(records => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (node instanceof Element) sweepAllAnchors(node);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
};
