/* @flow */
// RES-Slim: three small accessibility-flavour features bundled into one
// module to close the v0.10.x patch series.
//   1) Font size slider — global font scale for posts and comments.
//   2) Dyslexia-readable font — switch the host serif/sans stack to a
//      configurable readable family (OpenDyslexic, Atkinson Hyperlegible,
//      Lexend) loaded by name only — the user must already have the font
//      installed; we don't fetch web fonts.
//   3) Collapsible sidebar rail — narrow the right `.side` column to a
//      hover-expandable rail, freeing horizontal space without fully
//      hiding the sidebar.

import { Module } from '../core/module';

export const module: Module<{ [string]: any }> = new Module('a11yTriple');

module.moduleName = 'Accessibility triple';
module.category = 'appearanceCategory';
module.description = 'Three accessibility levers: global font size, dyslexia-readable font swap (font must be installed locally), and a hover-expandable sidebar rail.';
module.descriptionRaw = true;
module.include = ['r2'];
module.disabledByDefault = true;
module.keywords = ['accessibility', 'font', 'size', 'dyslexia', 'sidebar', 'rail'];

const FONT_PRESETS = [
	{ name: 'Default (Helvetica stack)', value: '' },
	{ name: 'OpenDyslexic', value: '"OpenDyslexic", "Helvetica Neue", Arial, sans-serif' },
	{ name: 'Atkinson Hyperlegible', value: '"Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif' },
	{ name: 'Lexend', value: '"Lexend", "Helvetica Neue", Arial, sans-serif' },
	{ name: 'System UI', value: 'system-ui, sans-serif' },
];

module.options = {
	fontSize: {
		type: 'enum',
		value: '100',
		title: 'Font size',
		values: [
			{ name: 'Default (100%)', value: '100' },
			{ name: 'Larger (110%)', value: '110' },
			{ name: 'Even larger (125%)', value: '125' },
			{ name: 'Largest (140%)', value: '140' },
		],
		description: 'Scale post titles, comment bodies, and tagline text. Sidebar widgets are untouched.',
	},
	readableFont: {
		type: 'enum',
		value: '',
		title: 'Readable font family',
		values: FONT_PRESETS,
		description: 'Replace the body font stack. The font must already be installed locally; the extension never downloads fonts.',
	},
	sidebarRail: {
		type: 'boolean',
		value: false,
		title: 'Collapsible sidebar rail',
		description: 'Narrow the right .side column to a 16-px rail that expands on hover. Mutex with layoutTweaks.hideSidebar.',
	},
};

const STYLE_ID = 'RSMA11yTripleStyle';
const BODY_CLASS = 'rsm-a11yTriple';
const FONT_CLASS = 'rsm-a11yTriple-font';
const RAIL_CLASS = 'rsm-a11yTriple-rail';

function fontSizeMultiplier(): number {
	const raw = parseInt(String(module.options.fontSize.value || '100'), 10);
	if (!Number.isFinite(raw) || raw < 80 || raw > 200) return 1.0;
	return raw / 100;
}

function buildCss(): string {
	const mult = fontSizeMultiplier();
	const font = (module.options.readableFont.value: any) || '';
	const rules: string[] = [];

	if (mult !== 1.0) {
		rules.push(`
			body.${BODY_CLASS} .thing.link .entry .title { font-size: ${(1.10 * mult).toFixed(3)}em !important; line-height: 1.35 !important; }
			body.${BODY_CLASS} .thing.comment .usertext-body { font-size: ${mult.toFixed(3)}em !important; line-height: 1.5 !important; }
			body.${BODY_CLASS} .thing .tagline { font-size: ${(0.95 * mult).toFixed(3)}em !important; }
		`);
	}

	if (font) {
		rules.push(`body.${FONT_CLASS} { font-family: ${font} !important; }`);
		rules.push(`body.${FONT_CLASS} .thing.comment .usertext-body, body.${FONT_CLASS} .thing.link .entry .title { font-family: ${font} !important; }`);
	}

	rules.push(`
		body.${RAIL_CLASS} .side {
			position: relative;
			width: 16px !important;
			max-width: 16px !important;
			min-width: 0 !important;
			overflow: hidden;
			transition: width .18s ease-out;
			background: linear-gradient(180deg, rgb(255 122 24 / 18%) 0%, rgb(255 122 24 / 4%) 100%);
		}

		body.${RAIL_CLASS} .side:hover,
		body.${RAIL_CLASS} .side:focus-within {
			width: 320px !important;
			max-width: 320px !important;
			background: inherit;
		}

		body.${RAIL_CLASS} .side > * {
			opacity: 0;
			transition: opacity .15s ease-out;
		}

		body.${RAIL_CLASS} .side:hover > *,
		body.${RAIL_CLASS} .side:focus-within > * {
			opacity: 1;
		}

		body.${RAIL_CLASS} .content[role='main'] {
			margin-right: 24px !important;
			max-width: none !important;
		}

		@media (prefers-reduced-motion: reduce) {
			body.${RAIL_CLASS} .side,
			body.${RAIL_CLASS} .side > * {
				transition: none !important;
			}
		}
	`);

	return rules.join('\n');
}

function applyClasses(): void {
	if (!document.body) return;
	const body = document.body;
	const mult = fontSizeMultiplier();
	body.classList.toggle(BODY_CLASS, mult !== 1.0);
	const font = (module.options.readableFont.value: any) || '';
	body.classList.toggle(FONT_CLASS, !!font);
	body.classList.toggle(RAIL_CLASS, module.options.sidebarRail.value === true);
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

module.beforeLoad = () => { injectStyle(); };
module.contentStart = () => { injectStyle(); applyClasses(); };
