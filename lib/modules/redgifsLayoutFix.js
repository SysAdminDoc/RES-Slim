/* @flow */
// RES-Slim: RedGifs v3 (post-2024 redesign) ships embeds inside a fixed
// 480×270 iframe wrapper with an aggressive overlay that hides the player
// controls. This module overrides the wrapper layout via body-class-gated
// CSS so the embed sits flush to the expando container, the controls are
// visible, and the iframe scales to the available width.

import { Module } from '../core/module';
import { Thing, watchForThings } from '../utils';

export const module: Module<{ [string]: any }> = new Module('redgifsLayoutFix');

module.moduleName = 'RedGifs v3 layout fix';
module.category = 'productivityCategory';
module.description = 'Normalises the RedGifs v3 iframe layout so embeds size correctly and the player controls are visible. Body-class-gated CSS only.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['redgifs', 'embed', 'iframe', 'video', 'layout'];

module.options = {
	enabled: {
		type: 'boolean',
		value: true,
		title: 'Enabled',
		description: 'Apply the RedGifs layout overrides. The module itself defaults off; this toggle exists so you can disable the fix without unloading the module.',
	},
	maxHeight: {
		type: 'enum',
		value: '600',
		title: 'Maximum height (px)',
		values: [
			{ name: '400 px', value: '400' },
			{ name: '500 px', value: '500' },
			{ name: '600 px', value: '600' },
			{ name: '720 px', value: '720' },
			{ name: 'Unlimited', value: '0' },
		],
		description: 'Cap the iframe height so a single RedGifs embed never dominates a thread. 0 disables the cap.',
	},
	hideRelated: {
		type: 'boolean',
		value: true,
		title: 'Hide related-content overlay',
		description: 'Suppress the "related videos" overlay RedGifs paints after a clip ends.',
	},
};

const STYLE_ID = 'RSMRedGifsLayoutFixStyle';
const BODY_CLASS = 'rsm-redgifsLayoutFix';
const IFRAME_SELECTOR = 'iframe[src*="redgifs.com/ifr/"], iframe[src*="redgifs.com/v/"], iframe[src*="redgifs.com/embed/"]';
const PROCESSED_ATTR = 'data-rsm-redgifs-fixed';

function buildCss(): string {
	if (module.options.enabled.value === false) return '';
	const maxHeightRaw = parseInt(String(module.options.maxHeight.value || '600'), 10);
	const cap = Number.isFinite(maxHeightRaw) && maxHeightRaw > 0 ? `${maxHeightRaw}px` : 'none';

	return `
		body.${BODY_CLASS} .expando iframe[src*="redgifs.com/ifr/"],
		body.${BODY_CLASS} .expando iframe[src*="redgifs.com/v/"],
		body.${BODY_CLASS} .expando iframe[src*="redgifs.com/embed/"] {
			width: 100% !important;
			max-width: 100% !important;
			max-height: ${cap};
			min-height: 320px;
			aspect-ratio: 16 / 9;
			background: #000;
			border: 0 !important;
			border-radius: 6px;
		}

		body.${BODY_CLASS} .expando[data-host="redgifs"] {
			padding: 0 !important;
			background: transparent !important;
		}

		body.${BODY_CLASS} .expando iframe[src*="redgifs.com"] + .toggleImage,
		body.${BODY_CLASS} .expando .redgifs-wrapper,
		body.${BODY_CLASS} .expando .RESImageAnchor[href*="redgifs.com"] + .toggleImage {
			display: none !important;
		}
	`;
}

function applyClasses(): void {
	if (!document.body) return;
	document.body.classList.toggle(BODY_CLASS, true);
}

function injectStyle(): void {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		(document.head || document.documentElement).append(style);
	}
	style.textContent = buildCss();
}

function rewriteIframe(node: HTMLIFrameElement): void {
	if (node.getAttribute(PROCESSED_ATTR) === '1') return;
	try {
		const u = new URL(node.src);
		if (u.searchParams.get('autoplay') !== '1') u.searchParams.set('autoplay', '1');
		if (u.searchParams.get('controls') !== '1') u.searchParams.set('controls', '1');
		// `related=0` is honoured by some RedGifs embed variants.
		if (u.searchParams.get('related') !== '0') u.searchParams.set('related', '0');
		if (u.toString() !== node.src) node.src = u.toString();
		node.setAttribute(PROCESSED_ATTR, '1');
	} catch (e) { /* malformed iframe src — leave alone */ }
}

function rewriteIframesIn(scope: ParentNode): void {
	const iframes = scope.querySelectorAll(IFRAME_SELECTOR);
	for (let i = 0; i < iframes.length; i++) {
		const node = iframes[i];
		if (node instanceof HTMLIFrameElement) rewriteIframe(node);
	}
}

function watchExpando(expando: HTMLElement): void {
	if (expando.getAttribute('data-rsm-redgifs-watch') === '1') return;
	expando.setAttribute('data-rsm-redgifs-watch', '1');
	rewriteIframesIn(expando);
	// Expandos init their iframe asynchronously after showImages flips
	// `expando-uninitialized` off. Scoped observer just on this container.
	const observer = new MutationObserver(records => {
		for (const rec of records) {
			for (const node of rec.addedNodes) {
				if (node instanceof HTMLIFrameElement && node.matches(IFRAME_SELECTOR)) {
					rewriteIframe(node);
				} else if (node instanceof Element) {
					rewriteIframesIn(node);
				}
			}
		}
	});
	observer.observe(expando, { childList: true, subtree: true });
}

function processThing(thing: Thing): void {
	if (module.options.hideRelated.value === false) return;
	const el = thing.element;
	if (!(el instanceof HTMLElement)) return;
	const expandos = el.querySelectorAll(':scope > .entry .expando, :scope > .entry .res-expando-box');
	for (let i = 0; i < expandos.length; i++) {
		const node = expandos[i];
		if (node instanceof HTMLElement) watchExpando(node);
	}
}

module.beforeLoad = () => { injectStyle(); };
module.contentStart = () => {
	injectStyle();
	applyClasses();
	if (module.options.hideRelated.value === false) return;
	// One-time sweep for iframes already in the DOM at load.
	rewriteIframesIn(document.body || document.documentElement);
	// Per-post scoped observers replace the prior body-wide MutationObserver.
	watchForThings(['post', 'comment'], processThing);
};
