/* @flow */
// RES-Slim: pageTheme — an opt-in dark/OLED skin for old.reddit itself.
// Combines a few community Stylus userstyles into one coherent, settings-driven
// theme. The actual CSS lives in lib/css/modules/_pageTheme.scss (shipped in the
// document_start content stylesheet); this module only toggles gate classes on
// <html> and applies the accent colour, so the whole thing is reversible.

import { Module } from '../core/module';
import * as Modules from '../core/modules';
import { desiredThemeClasses, sanitizeAccent, PAGE_THEME_IDS } from '../utils/pageTheme';
import { ANTI_FOUC_STYLE_ID } from '../core/theme/antiFouc';

export const module: Module<*> = new Module('pageTheme');

module.moduleName = 'Old Reddit theme';
module.category = 'appearanceCategory';
module.description = 'Dark / OLED skin for old.reddit with selectable palettes (OLED, Graphite, Midnight, Catppuccin, Tokyo Night, Rosé Pine), an accent colour, optional decluttering, rounded corners, and a collapse-to-hover sidebar. Disabled by default.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['theme', 'dark', 'oled', 'skin', 'palette', 'style', 'appearance', 'catppuccin'];

module.options = {
	theme: {
		type: 'enum',
		value: 'oled',
		title: 'Palette',
		description: 'Base colour scheme for the page. Dark palettes only.',
		values: [
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
		value: '#8a5cff',
		title: 'Accent colour',
		description: 'Used for visited links, flair outlines, and post-number chips.',
	},
	declutter: {
		type: 'boolean',
		value: true,
		title: 'Declutter chrome',
		description: 'Hide ads, banners, the redesign opt-in, gold prompts, and other page cruft.',
	},
	roundedCorners: {
		type: 'boolean',
		value: true,
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

function apply(classes: string[], accent: ?string) {
	const el = root();
	if (!el) return;
	dismissAntiFouc();
	clearThemeClasses(el);
	for (const cls of classes) el.classList.add(cls);
	if (accent) el.style.setProperty('--rsm-th-accent', accent);
	else el.style.removeProperty('--rsm-th-accent');
}

function clearAll() {
	const el = root();
	if (el) {
		clearThemeClasses(el);
		el.style.removeProperty('--rsm-th-accent');
	}
	try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* storage disabled */ }
}

// Apply the last-committed theme as early as possible (document_start) to avoid a
// flash of un-themed Reddit before the module lifecycle runs.
module.onInit = () => {
	try {
		const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
		if (cached && Array.isArray(cached.classes)) {
			apply(cached.classes.filter(c => typeof c === 'string' && c.startsWith('res-pageTheme')), sanitizeAccent(cached.accent));
		}
	} catch (e) {
		/* malformed cache — ignore */
	}
};

// Authoritative apply/refresh once options are loaded and on any change.
module.always = () => {
	if (!Modules.isRunning(module)) {
		clearAll();
		return;
	}
	const classes = currentClasses();
	const accent = sanitizeAccent(module.options.accent.value);
	apply(classes, accent);
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ classes, accent }));
	} catch (e) {
		/* storage disabled / quota — theme still applied in-memory */
	}
};

export { PAGE_THEME_IDS };
