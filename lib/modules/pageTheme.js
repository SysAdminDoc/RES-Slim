/* @flow */
// RES-Slim: pageTheme — shared skins for classic and current Reddit.
// Combines a few community Stylus userstyles into one coherent, settings-driven
// theme. The actual CSS lives in lib/css/modules/_pageTheme.scss (shipped in the
// document_start content stylesheet); this module only toggles gate classes on
// <html> and applies the accent colour, so the whole thing is reversible.

import { Module } from '../core/module';
import * as Modules from '../core/modules';
import { accentRoles, desiredThemeClasses, sanitizeAccent, PAGE_THEME_IDS } from '../utils/pageTheme';
import { ANTI_FOUC_STYLE_ID } from '../core/theme/antiFouc';

export const module: Module<{ [string]: any }> = new Module('pageTheme');

module.moduleName = 'Reddit theme';
module.category = 'appearanceCategory';
module.description = 'Make classic and current Reddit share the same old-Reddit layout, with a stock Classic Reddit palette plus dark alternatives, dense desktop layouts, an accent colour, decluttering, optional rounded corners, and a collapse-to-hover sidebar.';
module.descriptionRaw = true;
module.include = ['r2', 'd2x'];
module.keywords = ['theme', 'dark', 'oled', 'skin', 'palette', 'style', 'appearance', 'catppuccin', 'premium', 'layout'];

module.options = {
	theme: {
		type: 'enum',
		value: 'classic',
		title: 'Palette',
		description: 'Base colour scheme for the page. Classic Reddit reproduces the stock white-and-blue interface; the remaining palettes keep the same layout in dark colours.',
		values: [
			{ name: 'Classic Reddit', value: 'classic' },
			{ name: 'OLED Black', value: 'oled' },
			{ name: 'Graphite', value: 'graphite' },
			{ name: 'Midnight', value: 'midnight' },
			{ name: 'Catppuccin Mocha', value: 'catppuccin' },
			{ name: 'Tokyo Night', value: 'tokyonight' },
			{ name: 'Rosé Pine', value: 'rosepine' },
			{ name: 'Nord', value: 'nord' },
			{ name: 'Dracula', value: 'dracula' },
			{ name: 'Gruvbox Dark', value: 'gruvbox' },
			{ name: 'Solarized Dark', value: 'solarized' },
		],
	},
	accent: {
		type: 'color',
		value: '#551a8b',
		title: 'Accent colour',
		description: 'Used for visited links, flair outlines, and post-number chips.',
		// A colour picker can produce a shade that disappears on either a light or
		// dark palette. The page keeps its hue and corrects lightness by role.
		// The page corrects it either way; this says so, rather than leaving the
		// settings page showing a colour the page does not actually paint.
		advise(value: mixed, values: { [string]: mixed }) {
			const roles = accentRoles(value, values.theme);
			if (!roles.accent || !roles.textAdjusted) return null;

			const ratio = roles.ratio.toFixed(1);
			const suggestion = roles.text && roles.text.startsWith('#') ? roles.text : null;
			return {
				message: suggestion ?
					`This accent reaches only ${ratio}:1 against the palette, below the 4.5:1 needed for visited post titles. Titles and the focus outline will use the nearest readable shade of it instead.` :
					`This accent reaches only ${ratio}:1 against the palette and cannot be adjusted enough to fix, so titles and the focus outline fall back to the palette's strongest text colour.`,
				suggestion: suggestion ? { label: `Use ${suggestion}`, value: suggestion } : null,
			};
		},
	},
	declutter: {
		type: 'boolean',
		value: true,
		title: 'Declutter chrome',
		description: 'Hide ads, banners, the redesign opt-in, gold prompts, and other page cruft.',
	},
	refinedLayout: {
		type: 'boolean',
		value: true,
		title: 'Refined desktop layout',
		description: 'Rebuild current Reddit into old Reddit’s compact vote / thumbnail / entry rows and flat nested comments while preserving native controls.',
	},
	roundedCorners: {
		type: 'boolean',
		value: false,
		title: 'Rounded corners',
		description: 'Add a subtle 6px radius to posts, expandos, and the sidebar.',
	},
	collapseSidebar: {
		type: 'boolean',
		value: false,
		title: 'Collapse sidebar to hover',
		description: 'Shrink the right sidebar to a small corner tab that expands on hover, reclaiming width for content.',
	},
};

const CACHE_KEY = 'RES_pageTheme';

function root(): ?HTMLElement {
	return document.documentElement;
}

function clearThemeClasses(el: HTMLElement) {
	for (const cls of Array.from(el.classList)) {
		if (cls.startsWith('res-pageTheme')) el.classList.remove(cls);
	}
}

function currentClasses(): string[] {
	return desiredThemeClasses({
		theme: module.options.theme.value,
		declutter: module.options.declutter.value,
		refinedLayout: module.options.refinedLayout.value,
		roundedCorners: module.options.roundedCorners.value,
		collapseSidebar: module.options.collapseSidebar.value,
	});
}

// The document_start anti-FOUC style paints `:root.rsm-theme-oled body` with a
// hardcoded OLED background so the page is not white before the theme loads. That
// selector has the same specificity as this module's `html.res-pageTheme body`,
// and it is appended to `<head>` after the content-script stylesheet, so it wins
// on source order — every palette's background was silently replaced with OLED
// black. Measured in a browser: with the style removed, gruvbox paints #282828
// and solarized #002b36; with it present, both paint #050608.
//
// Its job is finished the moment a real palette is applied, so remove it here.
function dismissAntiFouc() {
	const style = document.getElementById(ANTI_FOUC_STYLE_ID);
	if (style) style.remove();
}

const ACCENT_PROPERTIES = ['--rsm-th-accent', '--rsm-th-accent-text', '--rsm-th-accent-ui'];

// The raw accent still drives the decorative `color-mix()` blends, which sit at
// 14-50% against a background and read fine at any darkness. Text and the focus
// outline get shades that clear their WCAG floor instead, because a `#333`
// accent on a dark palette makes visited titles unreadable and the focus ring
// invisible — a keyboard-accessibility failure with no feedback at all.
function apply(classes: string[], accent: ?string, theme: mixed) {
	const el = root();
	if (!el) return;
	dismissAntiFouc();
	clearThemeClasses(el);
	for (const cls of classes) el.classList.add(cls);

	const roles = accentRoles(accent, theme);
	if (roles.accent) {
		el.style.setProperty('--rsm-th-accent', roles.accent);
		el.style.setProperty('--rsm-th-accent-text', roles.text);
		el.style.setProperty('--rsm-th-accent-ui', roles.focus);
	} else {
		for (const prop of ACCENT_PROPERTIES) el.style.removeProperty(prop);
	}
}

function clearAll() {
	const el = root();
	if (el) {
		clearThemeClasses(el);
		for (const prop of ACCENT_PROPERTIES) el.style.removeProperty(prop);
	}
	try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* storage disabled */ }
}

// Apply the last-committed theme as early as possible (document_start) to avoid a
// flash of un-themed Reddit before the module lifecycle runs.
module.onInit = () => {
	try {
		const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
		if (cached && Array.isArray(cached.classes)) {
			apply(
				cached.classes.filter(c => typeof c === 'string' && c.startsWith('res-pageTheme')),
				sanitizeAccent(cached.accent),
				cached.theme,
			);
		}
	} catch (e) {
		/* malformed cache — ignore */
	}
};

// Authoritative apply/refresh once options are loaded and on any change.
module.always = () => {
	if (!Modules.isRunning(module)) {
		clearAll();
		unwatchHeaderHeight();
		return;
	}
	const classes = currentClasses();
	const accent = sanitizeAccent(module.options.accent.value);
	const theme = module.options.theme.value;
	apply(classes, accent, theme);
	if (classes.includes('res-pageTheme--refined')) watchHeaderHeight();
	else unwatchHeaderHeight();
	try {
		// The palette is cached alongside the accent because the corrected shades
		// are a property of the pair — replaying the accent against the wrong
		// palette at document_start would paint a shade the page then corrects,
		// which is a visible flash of the exact problem this fixes.
		localStorage.setItem(CACHE_KEY, JSON.stringify({ classes, accent, theme }));
	} catch (e) {
		/* storage disabled / quota — theme still applied in-memory */
	}
};

// WCAG 2.4.11 Focus Not Obscured (Minimum). `scroll-padding-block-start` needs a
// number, and the sticky header has no fixed one: `min-height` is 80px but three
// populated rows measure 172px on a 1440px viewport, and it reflows with the
// width. So the height is measured and published as a custom property that the
// stylesheet reads, with the min-height as its fallback.
//
// This is on the scrollport rather than `scroll-margin` per element, so it covers
// every scroll-into-view at once - sequential focus navigation, in-page anchors,
// and the several modules that call scrollIntoView themselves.
const HEADER_OFFSET_PROPERTY = '--rsm-th-header-height';
let headerObserver: ?ResizeObserver = null;

function publishHeaderHeight() {
	const el = root();
	const header = document.getElementById('header') || document.querySelector('reddit-header-large');
	if (!el || !(header instanceof HTMLElement)) return;
	const height = Math.round(header.getBoundingClientRect().height);
	if (height > 0) el.style.setProperty(HEADER_OFFSET_PROPERTY, `${height}px`);
}

function watchHeaderHeight() {
	const header = document.getElementById('header') || document.querySelector('reddit-header-large');
	if (!(header instanceof HTMLElement)) {
		// `always` can run before reddit's header is in the document, and it does
		// not necessarily run again afterwards. A one-shot here left the property
		// unset on most loads, so the scroll padding fell back to the 80px
		// min-height against a header that measures 172px - which is the defect
		// this was supposed to fix, restored to two thirds of its original size and
		// much harder to see. Measured across repeated runs: the padding read
		// `88px` about half the time.
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', watchHeaderHeight, { once: true });
		}
		return;
	}
	if (typeof ResizeObserver !== 'function') {
		publishHeaderHeight();
		return;
	}
	if (headerObserver) headerObserver.disconnect();
	headerObserver = new ResizeObserver(() => publishHeaderHeight());
	headerObserver.observe(header);
	publishHeaderHeight();
}

function unwatchHeaderHeight() {
	if (headerObserver) {
		headerObserver.disconnect();
		headerObserver = null;
	}
	const el = root();
	if (el) el.style.removeProperty(HEADER_OFFSET_PROPERTY);
}

// The DOM exists by contentStart, which `always` cannot promise.
module.contentStart = () => {
	if (currentClasses().includes('res-pageTheme--refined')) watchHeaderHeight();
};

export { PAGE_THEME_IDS };
