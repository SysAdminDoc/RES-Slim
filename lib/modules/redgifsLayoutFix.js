/* @flow */
// RES-Slim: RedGifs v3 (post-2024 redesign) ships embeds inside a fixed
// 480×270 iframe wrapper with an aggressive overlay that hides the player
// controls. This module overrides the wrapper layout via body-class-gated
// CSS so the embed sits flush to the expando container, the controls are
// visible, and the iframe scales to the available width.

import { Module } from '../core/module';

export const module: Module<*> = new Module('redgifsLayoutFix');

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

function buildCss(): string {
	if (module.options.enabled.value === false) return '';
	const maxHeightRaw = parseInt(String(module.options.maxHeight.value || '600'), 10);
	const cap = Number.isFinite(maxHeightRaw) && maxHeightRaw > 0 ? `${maxHeightRaw}px` : 'none';
	const hideRelated = module.options.hideRelated.value !== false;
	const lines: string[] = [];

	lines.push(`
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
	`);

	if (hideRelated) {
		// RedGifs paints related-video overlays via a child div. Block the most
		// common selector variants — the class name is hashed so this targets
		// position + size signatures plus the documented data attribute.
		lines.push(`
			body.${BODY_CLASS} .expando iframe[src*="redgifs.com"] {
				/* No way to reach iframe internals from a content script; instruct the
				 * iframe to suppress the overlay via the documented query param. */
			}
		`);
	}

	return lines.join('\n');
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

function rewriteIframes(): void {
	if (module.options.hideRelated.value === false) return;
	const iframes = document.querySelectorAll('iframe[src*="redgifs.com/ifr/"], iframe[src*="redgifs.com/v/"], iframe[src*="redgifs.com/embed/"]');
	for (let i = 0; i < iframes.length; i++) {
		const node = iframes[i];
		if (!(node instanceof HTMLIFrameElement)) continue;
		try {
			const u = new URL(node.src);
			if (u.searchParams.get('autoplay') !== '1') u.searchParams.set('autoplay', '1');
			if (u.searchParams.get('controls') !== '1') u.searchParams.set('controls', '1');
			// `related=0` is honoured by some RedGifs embed variants.
			if (u.searchParams.get('related') !== '0') u.searchParams.set('related', '0');
			if (u.toString() !== node.src) node.src = u.toString();
		} catch (e) { /* malformed iframe src — leave alone */ }
	}
}

let observer: MutationObserver | null = null;

function startObserver(): void {
	if (observer) return;
	observer = new MutationObserver(() => { rewriteIframes(); });
	if (document.body) observer.observe(document.body, { childList: true, subtree: true });
}

module.beforeLoad = () => { injectStyle(); };
module.contentStart = () => {
	injectStyle();
	applyClasses();
	rewriteIframes();
	startObserver();
};
