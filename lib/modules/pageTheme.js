/* @flow */
// RES-Slim: pageTheme — the default dark skin for old.reddit itself.
// Combines a few community Stylus userstyles into one coherent, settings-driven
// theme. The actual CSS lives in lib/css/modules/_pageTheme.scss (shipped in the
// document_start content stylesheet); this module only toggles gate classes on
// <html> and applies the accent colour, so the whole thing is reversible.

import { Module } from '../core/module';
import * as Modules from '../core/modules';
import { accentRoles, desiredThemeClasses, sanitizeAccent, PAGE_THEME_IDS } from '../utils/pageTheme';
import { ANTI_FOUC_STYLE_ID } from '../core/theme/antiFouc';

export const module: Module<*> = new Module('pageTheme');

module.moduleName = 'Old Reddit theme';
module.category = 'appearanceCategory';
module.description = 'A polished dark skin for old.reddit with a refined desktop layout, selectable palettes, an accent colour, decluttering, rounded corners, and an optional collapse-to-hover sidebar.';
module.descriptionRaw = true;
module.include = ['r2'];
module.keywords = ['theme', 'dark', 'oled', 'skin', 'palette', 'style', 'appearance', 'catppuccin', 'premium', 'layout'];

module.options = {
	theme: {
		type: 'enum',
		value: 'graphite',
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
		value: '#82bfff',
		title: 'Accent colour',
		description: 'Used for visited links, flair outlines, and post-number chips.',
		// A colour picker will happily hand back `#333`, which on any of these dark
		// palettes makes visited titles unreadable and the focus outline invisible.
		// The page corrects it either way; this says so, rather than leaving the
		// settings page showing a colour the page does not actually paint.
		advise(value: mixed, values: { [string]: mixed }) {
			const roles = accentRoles(value, values.theme);
			if (!roles.accent || !roles.textAdjusted) return null;

			const ratio = roles.ratio.toFixed(1);
			const suggestion = roles.text && roles.text.startsWith('#') ? roles.text : null;
			return {
				message: suggestion ?
					`This accent reaches only ${ratio}:1 against the palette, below the 4.5:1 needed for visited post titles. Titles and the focus outline will be painted a lighter shade of it instead.` :
					`This accent reaches only ${ratio}:1 against the palette and cannot be lightened enough to fix, so titles and the focus outline fall back to the palette's brightest text colour.`,
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
		description: 'Improve hierarchy, spacing, typography, focus states, feed cards, comments, navigation, forms, and sidebar surfaces while preserving old Reddit workflows.',
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
		return;
	}
	const classes = currentClasses();
	const accent = sanitizeAccent(module.options.accent.value);
	const theme = module.options.theme.value;
	apply(classes, accent, theme);
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

export { PAGE_THEME_IDS };
